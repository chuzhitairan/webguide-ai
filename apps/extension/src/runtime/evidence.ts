import type { Observation, SessionCheckpoint, TutorialIdentity } from '@webguide/contracts';

export const EVIDENCE_TTL_MS = 5 * 60_000;

export function sameTutorial(a: TutorialIdentity, b: TutorialIdentity): boolean {
  return a.id === b.id && a.version === b.version && a.contentHash === b.contentHash;
}

// 切换标签只撤销旧元素引用。先前已读到的不可变文件摘要仍可参与跨页核对。
export function currentEvidence(task: SessionCheckpoint, now: number): Observation[] {
  return task.observations.filter(o => o.taskId === task.taskId
    && o.targetRevision === task.target.targetRevision && sameTutorial(o.tutorialIdentity, task.tutorial)
    && o.status === 'ok' && o.invalidatedReason === null && o.observedAt <= now && now < o.expiresAt);
}

export function invalidateScope(task: SessionCheckpoint, objectKey: string, kinds: readonly string[]): void {
  let changed = false;
  for (const o of task.observations) {
    if (o.targetRevision === task.target.targetRevision && o.objectKey === objectKey
        && kinds.includes(o.kind) && o.invalidatedReason === null) {
      o.invalidatedReason = 'rechecking';
      changed = true;
    }
  }
  if (changed) task.evidenceRevision++;
}
