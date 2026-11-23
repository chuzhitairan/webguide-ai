import { coversGoal } from '../../../api/src/guide-protocol.js';
import type { Decision, EvidenceCheck, GuideRequest, Observation, ReadQuery, ReadResult, Requirement } from '../../../api/src/guide-protocol.js';

export type PageDecision = { kind: 'highlight'; targetId: number; instruction: string };
export type PageProof = { source: 'page'; checks: EvidenceCheck[] }
  | { source: 'point'; checks: EvidenceCheck[]; targetId: number };
export type GuideStatus = {
  kind: 'reading' | 'guiding' | 'asking' | 'waiting' | 'paused' | 'complete';
  text: string;
} | { kind: 'confirm'; text: string; index: number; result: string; source: 'user' | 'point' };

export type GuideProgress = { requirements: Requirement[]; confirmed: number[]; pointed?: number[]; answer?: string };

export interface GuidePage {
  snapshot(newRound: boolean): Promise<Observation>;
  read(queries: ReadQuery[]): Promise<ReadResult[]>;
  apply(decision: PageDecision): Promise<boolean>;
  verify(proofs: PageProof[], finish?: string): Promise<boolean>;
  trackScroll(id: number): void;
  clear(): void;
}

interface SessionOptions {
  choose(input: GuideRequest, signal: AbortSignal): Promise<Decision>;
  report(status: GuideStatus): void;
  used?: number;
  saveUsed?(used: number): Promise<void>;
  progress?: GuideProgress;
  saveProgress?(progress: GuideProgress): void;
}

const maxJudgments = 3;
export const guideRequestLimit = 12;
// 一轮内可能多次补看和询问模型。用户看完指引再操作的时间另计。
const roundTimeMs = 45_000;

export function createGuideSession(goal: string, options: SessionOptions) {
  let page: GuidePage | undefined;
  let inFlight: AbortController | undefined;
  let round = { judgments: 0, elapsed: 0, retried: false };
  let used = options.used ?? 0;
  let shown: NonNullable<GuideRequest['previous']> | undefined;
  let softPending = false;
  let asking = false;
  let completed = false;
  let answer = options.progress?.answer;
  let requirements = options.progress?.requirements ?? [];
  const confirmed = new Set(options.progress?.confirmed);
  const pointed = new Set(options.progress?.pointed);
  const proofs = new Map<number, PageProof>();
  let pending: { index: number; source: 'point' | 'user' } | undefined;
  let confirming = false;
  let revision = 0;

  function saveProgress() {
    options.saveProgress?.({ requirements, confirmed: [...confirmed], pointed: [...pointed], answer });
  }

  function markPointed(targetId: number) {
    // 成功画过高亮就是一次已交付的指路。换页后不需要从旧页面重新证明它。
    for (const [index, proof] of proofs) {
      if (proof.source === 'point' && proof.targetId === targetId) {
        pointed.add(index);
        proofs.delete(index);
      }
    }
    saveProgress();
  }

  function cancel() {
    revision++;
    inFlight?.abort();
    inFlight = undefined;
    softPending = false;
    pending = undefined;
    confirming = false;
    proofs.clear();
  }

  async function settle(view: GuidePage, current: () => boolean) {
    const userIndex = requirements.findIndex((item, index) => item.source === 'user' && !confirmed.has(index));
    const unshown = [...proofs.entries()].flatMap(([index, proof]) => proof.source === 'point' ? [{ index, proof }] : []);
    const [nextPoint] = unshown;
    const morePoints = new Set(unshown.map(item => item.proof.targetId)).size > 1;
    const verifyOnly = userIndex >= 0 || morePoints;
    const text = '已完成。' + requirements.map(item => item.result.replace(/[。！？.!?]+$/, '')
      + (item.source === 'user' ? '（由你确认）' : '')).join('，') + '。';
    if (!await view.verify([...proofs.values()], verifyOnly ? undefined : text) || !current()) return false;
    if (!verifyOnly) {
      completed = true;
      options.report({ kind: 'complete', text });
      return true;
    }
    if (nextPoint) {
      const { index, proof } = nextPoint;
      if (!await view.apply({ kind: 'highlight', targetId: proof.targetId, instruction: requirements[index].result }) || !current()) {
        return false;
      }
      markPointed(proof.targetId);
      if (morePoints) {
        pending = { index, source: 'point' };
        options.report({ kind: 'confirm', ...pending, result: requirements[index].result, text: '已标出一个入口。' });
        return true;
      }
    } else view.clear();
    shown = undefined;
    pending = { index: userIndex, source: 'user' };
    const verified = requirements.filter(item => item.source !== 'user').map(item => item.result.replace(/[。！？.!?]+$/, ''));
    const progress = verified.length ? `已核对网页结果，${verified.join('，')}。` : '';
    options.report({ kind: 'confirm', ...pending, result: requirements[userIndex].result, text: progress + '请确认下面这项结果。' });
    return true;
  }

  async function refresh(reason: 'user' | 'soft' | 'lost') {
    if (!page || completed || (asking && reason !== 'user') || ((pending || confirming) && reason === 'soft')) return;
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
    if (round.judgments >= maxJudgments || round.elapsed >= roundTimeMs) {
      if (!shown) options.report({ kind: 'paused', text: '还缺少能继续的页面线索。可以调整页面后再试。' });
      return;
    }
    const targetPage = page;
    const runningRound = round;
    const started = Date.now();
    const controller = new AbortController();
    inFlight = controller;
    const deadline = AbortSignal.timeout(roundTimeMs - round.elapsed);
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

      async function reread() {
        snapshot = await targetPage.snapshot(false);
        reads.length = 0;
        evidence.clear();
        proofs.clear();
        for (const node of snapshot.nodes) evidence.set(node.id, node);
        feedback = '目标或完成证据在当前页面未通过核对。请补看，或说明还缺少什么。';
      }

      while (current() && runningRound.judgments < maxJudgments && used < guideRequestLimit) {
        runningRound.judgments++;
        const finishOnly = runningRound.judgments === maxJudgments || used === guideRequestLimit - 1;
        const result = await decide({ goal, page: snapshot, reads: [...reads], previous: shown, feedback,
          finishOnly, userAnswer: answer, requirements });
        if (!current()) return;
        if (!requirements.length && result.requirements?.length && coversGoal(goal, result.requirements)) {
          requirements = result.requirements;
          saveProgress();
        }
        const pageRequirements = requirements.filter((item, index) =>
          item.source === 'page' || (item.source === 'point' && !pointed.has(index)));
        for (const { index, checks, targetId } of result.proofs ?? []) {
          const source = requirements[index]?.source;
          if (pointed.has(index) || !checks.every(check => evidence.has(check.id))) continue;
          const proof = source === 'page' ? { source, checks } as const
            : source === 'point' && targetId !== undefined && evidence.has(targetId) ? { source, checks, targetId } as const : undefined;
          if (!proof) continue;
          // 单项任务由收尾请求核对一次；组合任务先积累当前轮已复查的证据。
          if (pageRequirements.length === 1 || await targetPage.verify([proof])) proofs.set(index, proof);
          if (!current()) return;
        }
        if (requirements.length && proofs.size === pageRequirements.length) {
          if (await settle(targetPage, current) || !current()) return;
          // 现场变化后重新取证，上一份输出里的编号不再是最新证据。
          if (finishOnly) break;
          await reread();
          continue;
        }
        if (result.kind === 'observe' && !finishOnly) {
          const queryResults = await targetPage.read(result.queries);
          if (!current()) return;
          reads.push(...queryResults);
          for (const item of queryResults) for (const node of item.nodes) evidence.set(node.id, node);
          continue;
        }
        if (result.kind === 'highlight') {
          const target = evidence.get(result.targetId);
          if (reason === 'soft' && shown?.target && shown.target.id !== target?.id) return;
          const applied = target && await targetPage.apply({ kind: 'highlight', targetId: result.targetId, instruction: result.instruction });
          if (!current()) return;
          if (!applied) {
            if (finishOnly) break;
            await reread();
            continue;
          }
          if ([...proofs.values()].some(proof => proof.source === 'point' && proof.targetId === result.targetId)) {
            markPointed(result.targetId);
          }
          shown = { instruction: result.instruction, target };
          options.report({ kind: 'guiding', text: result.instruction });
          return;
        }
        if (result.kind === 'keep' && shown) return;
        if (result.kind === 'observe' || result.kind === 'keep' || result.kind === 'complete') break;
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
      requirements = [];
      confirmed.clear();
      pointed.clear();
      saveProgress();
      asking = false;
      return refresh('user');
    },
    async confirm(index: number) {
      if (!page || pending?.index !== index) return;
      const targetPage = page;
      const { source } = pending;
      const attempt = revision;
      const current = () => revision === attempt && page === targetPage;
      pending = undefined;
      confirming = true;
      if (source === 'user') {
        confirmed.add(index);
        saveProgress();
      }
      const settled = await settle(targetPage, current).catch(() => false);
      if (!current()) return;
      confirming = false;
      if (!settled) await refresh('user');
    },
  };
}
