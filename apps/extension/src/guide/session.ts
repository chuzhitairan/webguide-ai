import { acceptsRequirements, canReviewRequirements } from '../../../api/src/guide-protocol.js';
import type { Decision, EvidenceCheck, GuideRequest, Observation, ReadQuery, ReadResult, Requirement } from '../../../api/src/guide-protocol.js';

export type PageDecision = { kind: 'highlight'; targetId: number; instruction: string; scopeIds?: number[]; reveal?: true };
export type PageProof = { source: 'page' | 'arrival'; checks: EvidenceCheck[] }
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
  verify(proofs: PageProof[], finish?: string, reveal?: true): Promise<boolean>;
  trackScroll(id?: number): void;
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
  let pausedAfterError = false;
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

  function hasConflictingTargets(result: Decision): boolean {
    const targets = new Map<number, number>();
    for (const { index, targetId } of result.proofs ?? []) {
      if (requirements[index]?.source !== 'point' || pointed.has(index) || targetId === undefined) continue;
      const first = targets.get(index);
      if (first !== undefined && first !== targetId) return true;
      targets.set(index, targetId);
    }
    const onlyTarget = targets.get(0);
    return requirements.length === 1 && onlyTarget !== undefined
      && result.kind === 'highlight' && result.targetId !== onlyTarget;
  }

  async function settle(view: GuidePage, current: () => boolean, reveal = false) {
    const userIndex = requirements.findIndex((item, index) => item.source === 'user' && !confirmed.has(index));
    const unshown = [...proofs.entries()].flatMap(([index, proof]) => proof.source === 'point' ? [{ index, proof }] : []);
    const [nextPoint] = unshown;
    const morePoints = new Set(unshown.map(item => item.proof.targetId)).size > 1;
    const verifyOnly = userIndex >= 0 || morePoints;
    const text = '已完成。' + requirements.map(item => item.result.replace(/[。！？.!?]+$/, '')
      + (item.source === 'user' ? '（由你确认）' : '')).join('，') + '。';
    if (!await view.verify([...proofs.values()], verifyOnly ? undefined : text, ...(reveal && nextPoint ? [true as const] : []))
      || !current()) return false;
    if (!verifyOnly) {
      completed = true;
      options.report({ kind: 'complete', text });
      return true;
    }
    if (nextPoint) {
      const { index, proof } = nextPoint;
      const scopeIds = proof.checks.filter(check => check.field === 'label' && check.id !== proof.targetId).map(check => check.id);
      if (!await view.apply({ kind: 'highlight', targetId: proof.targetId, instruction: requirements[index].result,
        ...(scopeIds.length ? { scopeIds } : {}), ...(reveal ? { reveal: true } : {}) }) || !current()) {
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
      pausedAfterError = false;
      asking = false;
    }
    if (reason === 'lost') {
      cancel();
      shown = undefined;
    }
    if (inFlight || pausedAfterError) return;
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

    async function decide(input: Omit<GuideRequest, 'finishOnly'>) {
      async function send() {
        signal.throwIfAborted();
        if (used >= guideRequestLimit) throw new Error('本次引导已用完调用额度。');
        used++;
        // 重试也占一次额度。最后一次请求必须用手头的证据给出可交付的判断。
        const finishOnly = runningRound.judgments === maxJudgments || used === guideRequestLimit;
        await options.saveUsed?.(used);
        signal.throwIfAborted();
        const result = await options.choose({ ...input, finishOnly }, signal);
        return { result, finishOnly };
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
      // 只有用户开始或推进引导时才移动视口，后台复查沿用用户当前的位置。
      const canReveal = (proof: PageProof) => reason === 'user' && proof.source === 'point';
      const verifyObservedProof = (proof: PageProof) => canReveal(proof)
        ? targetPage.verify([proof], undefined, true) : targetPage.verify([proof]);
      let feedback: string | undefined;
      let reviewRequirements = false;
      let reviewedRequirements = false;

      async function reread(hint = '目标或完成证据在当前页面未通过核对。请补看，或说明还缺少什么。') {
        snapshot = await targetPage.snapshot(false);
        reads.length = 0;
        evidence.clear();
        proofs.clear();
        for (const node of snapshot.nodes) evidence.set(node.id, node);
        feedback = hint;
      }

      while (current() && runningRound.judgments < maxJudgments && used < guideRequestLimit) {
        runningRound.judgments++;
        const { result, finishOnly } = await decide({ goal, page: snapshot, reads: [...reads], previous: shown, feedback,
          userAnswer: answer, requirements, reviewRequirements: reviewRequirements ? true : undefined });
        if (!current()) return;
        if (result.requirements && acceptsRequirements(goal, result.requirements, requirements, reviewRequirements)) {
          requirements = result.requirements;
          // 已指过入口不能当作到达证明。条件变化后重新核对现场。
          for (const index of pointed) {
            if (requirements[index]?.source !== 'point') pointed.delete(index);
          }
          proofs.clear();
          saveProgress();
        }
        reviewRequirements = false;
        if (hasConflictingTargets(result)) {
          if (finishOnly) break;
          await reread('同一入口的完成证明指向多个控件。请核对唯一的最终控件，把所属对象放在同一条证明的 checks 中。');
          continue;
        }
        const pageRequirements = requirements.filter((item, index) =>
          item.source === 'page' || item.source === 'arrival' || (item.source === 'point' && !pointed.has(index)));
        const submitted = new Set<number>();
        for (const { index, checks, targetId } of result.proofs ?? []) {
          const source = requirements[index]?.source;
          if (pointed.has(index) || !checks.every(check => evidence.has(check.id))) continue;
          const proof = source === 'page' || source === 'arrival' ? { source, checks } as const
            : source === 'point' && targetId !== undefined && evidence.has(targetId) ? { source, checks, targetId } as const : undefined;
          if (!proof) continue;
          submitted.add(index);
          // 单项任务由收尾请求核对一次；组合任务先积累当前轮已复查的证据。
          if (pageRequirements.length === 1 || await verifyObservedProof(proof)) proofs.set(index, proof);
          if (!current()) return;
        }
        // 模型已经给每项都提交了证据，但只有部分通过。请它复核条件是否其实在描述同一个结果。
        if (!finishOnly && !reviewedRequirements && result.kind === 'keep' && canReviewRequirements(requirements)
          && submitted.size === requirements.length && proofs.size > 0 && proofs.size < requirements.length) {
          reviewedRequirements = true;
          reviewRequirements = true;
          // 条件未归并时，浏览器可以重核已有的证明。归并后会按新下标重新收集。
          const earlierProofs = [...proofs];
          await reread();
          for (const [index, proof] of earlierProofs) {
            if (!current()) return;
            const stillValid = proof.checks.every(check => evidence.has(check.id)) && await verifyObservedProof(proof);
            if (!current()) return;
            if (stillValid) proofs.set(index, proof);
          }
          const passed = [...proofs.keys()].sort((first, second) => first - second);
          const failed = requirements.map((_, index) => index).filter(index => !proofs.has(index));
          feedback = `当前已通过下标 ${passed.join('、') || '无'}，待核对下标 ${failed.join('、')}。无需归并时，优先处理待核对项。`;
          continue;
        }
        if (requirements.length && proofs.size === pageRequirements.length) {
          if (await settle(targetPage, current, [...proofs.values()].some(canReveal)) || !current()) return;
          // 现场变化后重新取证，上一份输出里的编号不再是最新证据。
          if (finishOnly) break;
          await reread(pageRequirements.some(item => item.source === 'point')
            ? '入口完成证据未通过。请复查目标是否可见可用。若有同名控件，请用 search 和 inspect 比较所属区域，再用 scopeId 指定实际包含目标的区域。'
            : pageRequirements.some(item => item.source === 'arrival')
              ? '到达证据未通过。请核对目标界面的标题或区域名称，以及同一区域内另一个可用控件或可读正文。'
              : undefined);
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
          const applied = target && await targetPage.apply({ kind: 'highlight', targetId: result.targetId, instruction: result.instruction,
            ...(result.scopeId === undefined ? {} : { scopeIds: [result.scopeId] }),
            ...(reason === 'user' ? { reveal: true } : {}) });
          if (!current()) return;
          if (!applied) {
            if (finishOnly) break;
            await reread('高亮目标或所属区域未通过核对。若有同名控件，先用 search 比较视口内外的候选，再用 scopeId 引用目标所属区域。');
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
        if (result.kind === 'message') {
          const regionId = result.scrollRegion;
          targetPage.trackScroll(regionId !== undefined && evidence.has(regionId) ? regionId : undefined);
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
        // 页面可能仍在更新。暂停后等用户继续或实际操作，避免后台悄悄开启下一次判断。
        pausedAfterError = true;
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
      const settled = await settle(targetPage, current, true).catch(() => false);
      if (!current()) return;
      confirming = false;
      if (!settled) await refresh('user');
    },
  };
}
