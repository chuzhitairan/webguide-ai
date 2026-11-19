import type { SessionCheckpoint } from '@webguide/contracts';

export const TASK_LIMIT = 5;
const OBSERVATION_LIMIT = 100;
const SNAPSHOT_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

export function fitCheckpoint(task: SessionCheckpoint, others: readonly SessionCheckpoint[], now: number): boolean {
  // 按整个会话的 UTF-8 字节数计，中文字符数不是字节数。
  const otherBytes = others.filter(other => other.taskId !== task.taskId)
    .reduce((sum, other) => sum + encoder.encode(JSON.stringify(other)).length, 0);
  const fits = () => task.observations.length <= OBSERVATION_LIMIT
    && otherBytes + encoder.encode(JSON.stringify(task)).length <= SNAPSHOT_BYTES;
  if (fits()) return true;
  pruneUnusedHistory(task, now);
  return fits();
}

export function pruneUnusedHistory(task: SessionCheckpoint, now: number): boolean {
  const before = task.observations.length;
  const referenced = new Set(task.decision?.evidenceIds);
  for (const step of Object.values(task.stepChecks)) {
    for (const id of step.evidenceIds) referenced.add(id);
  }
  for (const id of task.decision?.commitCandidate?.sourceObservationIds ?? []) referenced.add(id);
  for (const id of task.target.commitAnchor?.sourceObservationIds ?? []) referenced.add(id);
  if ('prBinding' in task.target && task.target.prBinding) referenced.add(task.target.prBinding.sourceObservationId);
  if ('branchStart' in task.target) {
    for (const id of task.target.branchStart?.sourceObservationIds ?? []) referenced.add(id);
  }
  task.observations = task.observations.filter(o => referenced.has(o.id) ||
    (o.expiresAt > now && o.invalidatedReason === null && o.targetRevision === task.target.targetRevision));
  return before !== task.observations.length;
}
