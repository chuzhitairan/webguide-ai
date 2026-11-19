import type { SessionCheckpoint } from '@webguide/contracts';

export interface SessionStoragePort {
  get(keys: null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface Store {
  readAll(): Promise<SessionCheckpoint[]>;
  write(snapshot: SessionCheckpoint): Promise<void>;
  remove(taskId: string): Promise<void>;
}

const prefix = 'webguide.task.';
const states = ['ready', 'checking', 'guiding', 'waiting', 'blocked', 'pending', 'paused', 'ended'];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function strings(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}
function decision(value: unknown): boolean {
  return record(value) && ['pass', 'actionable', 'wait', 'unknown', 'blocked'].includes(String(value.status))
    && strings(value.evidenceIds) && strings(value.reasonCodes) && strings(value.missing) && strings(value.conflicts);
}
function identity(value: unknown): boolean {
  return record(value) && ['id', 'version', 'contentHash'].every(key => typeof value[key] === 'string');
}
function revision(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function validTarget(value: unknown): boolean {
  if (!record(value) || typeof value.repo !== 'string' || !revision(value.targetRevision)) return false;
  if (value.profile === 'pages_branch_v1') return typeof value.branch === 'string' && typeof value.expectedContent === 'string';
  return (value.profile === 'collaboration_pr_v1' || (value.profile === 'fixture_collaboration_v1' && strings(value.origins)))
    && ['member', 'baseBranch', 'headBranch', 'documentPath'].every(key => typeof value[key] === 'string')
    && Number.isSafeInteger(value.issueNumber) && record(value.expectedEdit)
    && ['before', 'after', 'practiceMarker'].every(key => typeof (value.expectedEdit as Record<string, unknown>)[key] === 'string');
}

function checkpoint(value: unknown, id: string): value is SessionCheckpoint {
  if (!record(value) || value.checkpointSchema !== 1 || value.taskId !== id || !identity(value.tutorial)
    || !validTarget(value.target) || !states.includes(String(value.state))) return false;
  const stop = value.stopStatus;
  return typeof value.displayStepId === 'string' && typeof value.frontierStepId === 'string'
    && (value.navigationIntent === 'advance' || value.navigationIntent === 'review')
    && ['sessionRevision', 'contextRevision', 'evidenceRevision', 'updatedAt'].every(key => revision(value[key]))
    && (value.owner === null || (record(value.owner) && Number.isSafeInteger(value.owner.windowId)
      && typeof value.owner.uiInstanceId === 'string'))
    && Array.isArray(value.bindings) && value.bindings.every(b => record(b) && typeof b.id === 'string'
      && typeof b.documentId === 'string' && revision(b.navigationRevision) && typeof b.url === 'string')
    && Array.isArray(value.observations) && value.observations.every(o => record(o) && identity(o.tutorialIdentity)
      && typeof o.id === 'string' && typeof o.objectKey === 'string' && typeof o.kind === 'string'
      && record(o.payload) && revision(o.observedAt) && revision(o.expiresAt))
    && record(value.stepChecks) && Object.values(value.stepChecks).every(decision)
    && (value.decision === null || decision(value.decision))
    && (value.endedReason === null || typeof value.endedReason === 'string')
    && (value.state === 'ended' ? ['incomplete', 'user-confirmed', 'system-verified'].includes(String(value.result)) : value.result === null)
    && (value.result !== 'system-verified' || (record(value.decision) && value.decision.status === 'pass'
      && value.navigationIntent === 'advance' && value.observations.length > 0))
    && record(stop) && revision(stop.epoch) && strings(stop.pendingBindings) && strings(stop.failedBindings);
}

export function createSessionStore(port: SessionStoragePort): Store {
  return {
    async readAll() {
      const tasks: SessionCheckpoint[] = [];
      for (const [key, value] of Object.entries(await port.get(null))) {
        if (!key.startsWith(prefix)) continue;
        // 数据不兼容时保留原记录，让界面提示重新开始；不要猜测旧结果。
        if (!checkpoint(value, key.slice(prefix.length))) throw Error('invalid-checkpoint');
        tasks.push(value);
      }
      return tasks;
    },
    write: task => port.set({ [prefix + task.taskId]: task }),
    remove: taskId => port.remove(prefix + taskId),
  };
}
