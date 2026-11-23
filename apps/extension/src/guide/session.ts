import type { Decision, GuideRequest, Observation, ReadQuery, ReadResult } from '../../../api/src/guide-protocol.js';

export type PageDecision = Extract<Decision, { kind: 'highlight' | 'complete' }>;
export type GuideStatus = {
  kind: 'reading' | 'guiding' | 'asking' | 'waiting' | 'paused' | 'complete';
  text: string;
};

export interface GuidePage {
  snapshot(newRound: boolean): Promise<Observation>;
  read(queries: ReadQuery[]): Promise<ReadResult[]>;
  apply(decision: PageDecision): Promise<boolean>;
  trackScroll(id: number): void;
  clear(): void;
}

interface SessionOptions {
  choose(input: GuideRequest, signal: AbortSignal): Promise<Decision>;
  report(status: GuideStatus): void;
  used?: number;
  saveUsed?(used: number): Promise<void>;
}

const maxJudgments = 3;
export const guideRequestLimit = 12;
const roundTime = 20_000;

export function createGuideSession(goal: string, options: SessionOptions) {
  let page: GuidePage | undefined;
  let inFlight: AbortController | undefined;
  let round = { judgments: 0, elapsed: 0, retried: false };
  let used = options.used ?? 0;
  let shown: NonNullable<GuideRequest['previous']> | undefined;
  let softPending = false;
  let asking = false;
  let completed = false;
  let answer: string | undefined;

  function cancel() {
    inFlight?.abort();
    inFlight = undefined;
    softPending = false;
  }

  async function refresh(reason: 'user' | 'soft' | 'lost') {
    if (!page || completed || (asking && reason !== 'user')) return;
    if (reason === 'soft' && inFlight) {
      softPending = true;
      return;
    }
    if (reason === 'user') {
      cancel();
      round = { judgments: 0, elapsed: 0, retried: false };
      asking = false;
    }
    if (reason === 'lost') {
      cancel();
      shown = undefined;
    }
    if (inFlight) return;
    if (used >= guideRequestLimit) {
      options.report({ kind: 'paused', text: '本次引导已用完调用额度。可以继续尝试。' });
      return;
    }
    if (round.judgments >= maxJudgments || round.elapsed >= roundTime) {
      if (!shown) options.report({ kind: 'paused', text: '还缺少能继续的页面线索。可以调整页面后再试。' });
      return;
    }
    const targetPage = page;
    const runningRound = round;
    const started = Date.now();
    const controller = new AbortController();
    inFlight = controller;
    const deadline = AbortSignal.timeout(roundTime - round.elapsed);
    const signal = AbortSignal.any([controller.signal, deadline]);
    const current = () => inFlight === controller && !signal.aborted;
    if (!shown) options.report({ kind: 'reading', text: '正在查看当前页面…' });

    async function decide(input: GuideRequest): Promise<Decision> {
      async function send() {
        signal.throwIfAborted();
        if (used >= guideRequestLimit) throw new Error('本次引导已用完调用额度。');
        used++;
        await options.saveUsed?.(used);
        signal.throwIfAborted();
        return options.choose(input, signal);
      }
      try {
        return await send();
      } catch (error) {
        if (signal.aborted || runningRound.retried || used >= guideRequestLimit) throw error;
        runningRound.retried = true;
        return await send();
      }
    }

    try {
      let snapshot = await targetPage.snapshot(reason === 'user');
      const reads: ReadResult[] = [];
      const evidence = new Map(snapshot.nodes.map(node => [node.id, node]));
      let feedback: string | undefined;
      while (current() && runningRound.judgments < maxJudgments && used < guideRequestLimit) {
        runningRound.judgments++;
        const finishOnly = runningRound.judgments === maxJudgments || used === guideRequestLimit - 1;
        const result = await decide({ goal, page: snapshot, reads: [...reads], previous: shown, feedback, finishOnly, userAnswer: answer });
        if (!current()) return;
        if (result.kind === 'observe' && !finishOnly) {
          const queryResults = await targetPage.read(result.queries);
          if (!current()) return;
          reads.push(...queryResults);
          for (const item of queryResults) for (const node of item.nodes) evidence.set(node.id, node);
          continue;
        }
        if (result.kind === 'highlight' || result.kind === 'complete') {
          const target = result.targetId === undefined ? undefined : evidence.get(result.targetId);
          if (reason === 'soft' && shown?.target && result.kind === 'highlight' && shown.target.id !== target?.id) return;
          const known = (result.targetId === undefined || target)
            && (result.kind !== 'complete' || result.checks.every(check => evidence.has(check.id)));
          const applied = known && await targetPage.apply(result);
          if (!current()) return;
          if (!applied) {
            if (finishOnly) break;
            // 页面可能在模型判断期间变了。下一次判断使用现场快照，旧补看一并作废。
            snapshot = await targetPage.snapshot(false);
            if (!current()) return;
            reads.length = 0;
            evidence.clear();
            for (const node of snapshot.nodes) evidence.set(node.id, node);
            feedback = '目标或完成证据在当前页面未通过核对。请补看，或说明还缺少什么。';
            continue;
          }
          if (result.kind === 'complete') {
            completed = true;
            options.report({ kind: 'complete', text: result.instruction });
            return;
          }
          shown = { instruction: result.instruction, target };
          options.report({ kind: 'guiding', text: result.instruction });
          return;
        }
        if (result.kind === 'keep' && shown) return;
        if (result.kind === 'observe' || result.kind === 'keep') break;
        if (reason === 'soft' && shown?.target && result.kind === 'message') return;
        targetPage.clear();
        if (result.kind === 'message' && result.scrollRegion !== undefined && evidence.has(result.scrollRegion)) {
          targetPage.trackScroll(result.scrollRegion);
        }
        shown = { instruction: result.instruction };
        asking = result.kind === 'ask';
        options.report({
          kind: asking ? 'asking' : result.kind === 'blocked' ? 'paused' : result.kind === 'wait' ? 'waiting' : 'guiding',
          text: result.instruction,
        });
        return;
      }
      if (inFlight === controller && !shown) {
        options.report({ kind: 'paused', text: deadline.aborted ? '等待模型超时，可以重试。' : '当前证据不足，请调整页面后再试。' });
      }
    } catch (error) {
      if (inFlight === controller) {
        const text = deadline.aborted ? '等待模型超时，可以重试。'
          : error instanceof Error ? error.message : '暂时无法继续引导。';
        options.report({ kind: 'paused', text });
      }
    } finally {
      runningRound.elapsed += Date.now() - started;
      if (inFlight === controller) {
        inFlight = undefined;
        if (softPending) {
          softPending = false;
          void refresh('soft');
        }
      }
    }
  }

  return {
    attach(next: GuidePage) {
      page?.clear();
      page = next;
      shown = undefined;
      asking = false;
      return refresh('user');
    },
    invalidate() {
      cancel();
      page?.clear();
      shown = undefined;
    },
    detach() {
      cancel();
      page?.clear();
      page = undefined;
      shown = undefined;
    },
    refresh,
    reply(value: string) {
      answer = value;
      asking = false;
      return refresh('user');
    },
  };
}
