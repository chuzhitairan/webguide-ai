import type {
  Capabilities, CheckRequest, Decision, Effect, EvaluationInput, Observation, Owner, PageBinding, RequestIdentity,
  RuntimeEvent, SessionCheckpoint, ShowGuide, TaskTarget, TrustedSender, TutorialIdentity, TutorialStep, TutorialVersion,
} from '@webguide/contracts';
import type { Store } from '../browser/session-store.js';
import { currentEvidence, EVIDENCE_TTL_MS, invalidateScope, sameTutorial } from './evidence.js';
import { fitCheckpoint, pruneUnusedHistory, TASK_LIMIT } from './limits.js';

type RegisteredTutorial = { tutorial: TutorialVersion; identity: TutorialIdentity };
export interface CoordinatorDeps {
  store: Store;
  clock: { now(): number };
  makeId(): string;
  resolveTutorial(id: string, version: string): RegisteredTutorial | undefined | null | Promise<RegisteredTutorial | undefined | null>;
  capabilities: Capabilities;
  roleKinds?: Readonly<Record<string, string>>;
  evaluate(input: EvaluationInput): Decision;
  emit(effect: Effect): void | Promise<void>;
  publish(snapshot: SessionCheckpoint): void | Promise<void>;
  schedule?(ms: number, callback: () => void): () => void;
}

export interface CommandResult {
  status: 'accepted' | 'rejected' | 'conflict';
  reason?: string;
  snapshot?: SessionCheckpoint;
}
export interface Coordinator {
  epoch: string;
  snapshot(taskId?: string): SessionCheckpoint | undefined;
  snapshots(): SessionCheckpoint[];
  handle(event: RuntimeEvent, sender: TrustedSender): Promise<CommandResult>;
  recover(): Promise<void>;
}

type RoundRequest = { request: CheckRequest; kinds: readonly string[]; answered: boolean; cancelTimer?: () => void };
const CHECK_TIMEOUT_MS = 3000;
const LEASE_MS = 6000;
const RENEW_MS = 2000;

function problem(reason: string): Decision {
  return { status: 'unknown', reasonCodes: [reason], missing: [reason], conflicts: [], evidenceIds: [] };
}
function owns(owner: Owner | null | undefined, sender: TrustedSender): boolean {
  return !!owner && sender.kind === 'ui' && owner.windowId === sender.windowId && owner.uiInstanceId === sender.uiInstanceId;
}
function samePage(b: PageBinding, sender: TrustedSender): boolean {
  return sender.kind === 'page' && b.tabId === sender.tabId && b.windowId === sender.windowId
    && b.frameId === 0 && sender.frameId === 0 && !!b.documentId && b.documentId === sender.documentId && b.url === sender.url;
}
function sameRequest(a: RequestIdentity, b: RequestIdentity): boolean {
  return a.coordinatorEpoch === b.coordinatorEpoch && a.taskId === b.taskId && a.requestId === b.requestId
    && a.contextRevision === b.contextRevision && a.targetRevision === b.targetRevision && sameTutorial(a.tutorialIdentity, b.tutorialIdentity)
    && a.bindingId === b.bindingId && a.documentId === b.documentId && a.navigationRevision === b.navigationRevision
    && a.checkSequence === b.checkSequence;
}
function validStart(target: TaskTarget): boolean {
  if (!target || target.targetRevision !== 1 || target.commitAnchor !== null || !target.repo) return false;
  if (target.profile === 'pages_branch_v1') return target.siteBinding === null && !!target.branch && !!target.expectedContent;
  const edit = target.expectedEdit;
  return !!edit && !!edit.before && !!edit.after && edit.before !== edit.after && !!edit.practiceMarker
    && edit.after.includes(edit.practiceMarker) && !edit.before.includes(edit.practiceMarker)
    && target.branchStart === null && target.prBinding === null && Number.isSafeInteger(target.issueNumber)
    && target.issueNumber > 0 && !!target.member && !!target.baseBranch && !!target.headBranch && target.baseBranch !== target.headBranch
    && typeof target.documentPath === 'string' && /\.md$/i.test(target.documentPath)
    && !target.documentPath.split(/[\\/]/).some(part => !part || part === '..' || part === '.')
    && (target.profile !== 'fixture_collaboration_v1' || (Array.isArray(target.origins) && target.origins.length > 0
      && target.origins.every(o => o === 'http://127.0.0.1:43131' || o === 'http://127.0.0.1:43132')));
}

export function createCoordinator(deps: CoordinatorDeps): Coordinator {
  const epoch = deps.makeId();
  const tasks = new Map<string, SessionCheckpoint>();
  const tutorials = new Map<string, TutorialVersion>();
  const previousOwners = new Map<string, Owner>();
  const replies = new Map<string, CommandResult>();
  // 一次只有一个活动任务。请求只留内存，后台换代后任何旧页面都必须重新握手。
  const requests = new Map<string, RoundRequest>();
  let sequence = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let cancelRenewal: (() => void) | undefined;
  let cancelExpiry: (() => void) | undefined;
  const schedule = deps.schedule ?? ((ms, callback) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  });
  const now = () => deps.clock.now();
  const records = () => [...tasks.values()];
  const active = () => records().find(task => task.owner !== null);
  const clone = <T>(value: T): T => structuredClone(value);

  function serial<T>(action: () => Promise<T>): Promise<T> {
    const next = queue.then(action);
    queue = next.catch(() => {});
    return next;
  }
  function response(status: CommandResult['status'], task?: SessionCheckpoint, reason?: string): CommandResult {
    return { status, ...(task && { snapshot: clone(task) }), ...(reason && { reason }) };
  }
  // 页面投递可能要等端口回复。只将命令交给端口，STOP 和下一条用户命令始终可以入队。
  function send(effect: Effect): void {
    try { void Promise.resolve(deps.emit(clone(effect))).catch(() => {}); } catch { /* 页面失联靠超时和租期收束。 */ }
  }
  function publish(task: SessionCheckpoint): void {
    try { void Promise.resolve(deps.publish(clone(task))).catch(() => {}); } catch { /* 侧栏重连时读取最新快照。 */ }
  }
  function clearRound(task: SessionCheckpoint, effects: Effect[], reason: string): void {
    cancelRenewal?.(); cancelExpiry?.();
    for (const [id, item] of requests) {
      if (item.request.taskId !== task.taskId) continue;
      item.cancelTimer?.();
      effects.push({ ...item.request, type: 'CANCEL_REQUEST', reason });
      requests.delete(id);
    }
  }

  function stop(task: SessionCheckpoint, effects: Effect[], reason: string, ended = false): void {
    clearRound(task, effects, reason);
    if (task.owner) previousOwners.set(task.taskId, task.owner);
    task.owner = null;
    task.contextRevision++;
    task.state = ended ? 'ended' : 'paused';
    task.result = ended ? 'incomplete' : null;
    task.endedReason = reason;
    task.stopStatus = { epoch: task.stopStatus.epoch + 1, pendingBindings: task.bindings.map(b => b.id), failedBindings: [] };
    for (const b of task.bindings) effects.push({ type: 'STOP', taskId: task.taskId, coordinatorEpoch: epoch,
      contextRevision: task.contextRevision, bindingId: b.id, documentId: b.documentId, stopEpoch: task.stopStatus.epoch, reason });
  }

  function stepOf(task: SessionCheckpoint): TutorialStep {
    return tutorials.get(task.taskId)!.steps.find(step => step.id === task.displayStepId)!;
  }
  function beginRound(task: SessionCheckpoint, effects: Effect[]): void {
    clearRound(task, effects, 'context-changed');
    task.contextRevision++;
    task.decision = null;
    const tutorial = tutorials.get(task.taskId)!;
    const step = stepOf(task);
    const checkerId = step.check.type === 'adapter' ? step.check.checkerId : 'dom.' + step.check.assertion;
    const capability = deps.capabilities.adapters[tutorial.adapterId]!.checkers[checkerId];
    const roles = capability?.readRoles ?? [step.pageRole];
    // 同一对象开了两个标签时只读最近握手的一个，防止旧标签的慢回包覆盖新结果。
    const selected = new Map<string, PageBinding>();
    for (const b of task.bindings) if (roles.includes(b.pageRole) && b.windowId === task.owner?.windowId) {
      selected.set(JSON.stringify([b.pageRole, b.objectKey]), b);
    }
    for (const b of selected.values()) {
      const kinds = capability?.observationKinds ?? ['dom'];
      invalidateScope(task, b.objectKey, kinds);
      const request: CheckRequest = {
        type: 'CHECK_REQUEST', coordinatorEpoch: epoch, taskId: task.taskId, contextRevision: task.contextRevision,
        targetRevision: task.target.targetRevision, tutorialIdentity: task.tutorial, bindingId: b.id, documentId: b.documentId,
        navigationRevision: b.navigationRevision, requestId: deps.makeId(), checkSequence: ++sequence,
        stepId: step.id, checkerId, pageRole: b.pageRole, objectKey: b.objectKey, target: task.target,
        targetSpec: step.target, check: step.check,
      };
      requests.set(b.id, { request, kinds, answered: false });
      effects.push(request);
    }
    task.state = selected.size ? 'checking' : 'pending';
    if (!selected.size) task.decision = problem('page-required');
  }

  function dispatch(effect: Effect): void {
    send(effect);
    if (effect.type === 'CHECK_REQUEST') {
      const slot = requests.get(effect.bindingId);
      if (slot?.request.requestId === effect.requestId) {
        slot.cancelTimer = schedule(CHECK_TIMEOUT_MS, () => {
          void handle({ type: 'CHECK_TIMEOUT', request: effect }, { kind: 'system' });
        });
      }
    } else if (effect.type === 'SHOW_GUIDE') {
      const renew = () => {
        const saved = tasks.get(effect.taskId);
        if (saved?.owner && saved.state === 'guiding' && saved.contextRevision === effect.contextRevision
            && requests.get(effect.bindingId)?.request.requestId === effect.requestId) {
          send(effect);
          cancelRenewal = schedule(RENEW_MS, renew);
        }
      };
      cancelRenewal?.();
      cancelRenewal = schedule(RENEW_MS, renew);
    }
  }

  function armExpiry(task: SessionCheckpoint): void {
    if (!task.owner || !task.decision) return;
    const ids = new Set(task.decision.evidenceIds);
    const evidence = currentEvidence(task, now()).filter(o => ids.has(o.id));
    if (!evidence.length) return;
    const expiresAt = Math.min(...evidence.map(o => o.expiresAt));
    cancelExpiry?.();
    cancelExpiry = schedule(Math.max(0, expiresAt - now()), () => {
      void serial(async () => {
        const saved = tasks.get(task.taskId);
        if (!saved?.owner || saved.contextRevision !== task.contextRevision || saved.sessionRevision !== task.sessionRevision) return;
        const next = clone(saved), effects: Effect[] = [];
        beginRound(next, effects);
        await commit(next, effects);
      });
    });
  }

  async function makeRoom(task: SessionCheckpoint): Promise<boolean> {
    if (fitCheckpoint(task, records(), now())) return true;
    // 配额按会话计算。其他暂停任务只清理可丢弃的历史，每条记录独立保存，写入成功后才通知侧栏。
    for (const saved of records()) {
      if (saved.taskId === task.taskId || saved.owner) continue;
      const other = clone(saved);
      if (!pruneUnusedHistory(other, now())) continue;
      other.sessionRevision++;
      other.updatedAt = now();
      await deps.store.write(clone(other));
      tasks.set(other.taskId, other); publish(other);
      if (fitCheckpoint(task, records(), now())) return true;
    }
    return false;
  }

  async function commit(task: SessionCheckpoint, effects: Effect[], checkCapacity = false): Promise<CommandResult> {
    const original = tasks.get(task.taskId);
    task.sessionRevision++;
    task.updatedAt = now();
    try {
      if (checkCapacity && !await makeRoom(task)) {
        if (!original) return response('rejected', undefined, 'capacity-exceeded');
        const safe = clone(original), stopping: Effect[] = [];
        stop(safe, stopping, 'capacity-exceeded');
        safe.decision = problem('capacity-exceeded');
        const result = await commit(safe, stopping);
        return response('rejected', result.snapshot, result.reason ?? 'capacity-exceeded');
      }
      await deps.store.write(clone(task));
    } catch {
      // 写失败不能公布刚得出的成功或指示。保留上次证据，先让所有页面撤下蓝框。
      const safe = clone(original ?? task), stopping: Effect[] = [];
      if (original || safe.owner) {
        // 本轮握手可能首次建立绑定，即使写失败也要让该页面停止。
        for (const b of task.bindings) if (!safe.bindings.some(old => old.id === b.id)) safe.bindings.push(b);
        stop(safe, stopping, 'storage-error');
        safe.decision = problem('storage-error');
        stopping.forEach(send);
        // 首次写入失败不留下未创建的任务。已有任务的保守暂停尽可能写回。
        if (original) {
          safe.sessionRevision = original.sessionRevision + 1; safe.updatedAt = now();
          tasks.set(safe.taskId, safe);
          try { await deps.store.write(clone(safe)); } catch { /* 下次启动仍会保守暂停。 */ }
          publish(safe);
        }
      }
      return response('rejected', original ? safe : undefined, 'storage-error');
    }
    tasks.set(task.taskId, task);
    publish(task);
    effects.forEach(dispatch);
    armExpiry(task);
    return response('accepted', task);
  }

  function evaluate(task: SessionCheckpoint, effects: Effect[]): void {
    const step = stepOf(task), tutorial = tutorials.get(task.taskId)!;
    const observations = currentEvidence(task, now());
    const accepted = new Set([...requests.values()].filter(r => r.answered).map(r => r.request.requestId));
    const fresh = observations.filter(o => accepted.has(o.requestId));
    const locations = fresh.flatMap(o => o.location ? [o.location] : []);
    const checkerId = step.check.type === 'adapter' ? step.check.checkerId : 'dom.' + step.check.assertion;
    const check = (final: boolean): Decision => {
      const decision = deps.evaluate({ tutorialIdentity: task.tutorial, target: task.target, stepId: step.id,
        checkerId: final ? tutorial.finalVerifierId : checkerId, intent: task.navigationIntent, final, observations, locations, now: now() });
      const validIds = new Set(observations.map(o => o.id));
      if (decision.evidenceIds.some(id => !validIds.has(id)) || (decision.status === 'pass' && !decision.evidenceIds.length)) {
        return problem('evidence-missing');
      }
      return decision;
    };
    let decision = check(false);
    task.stepChecks[step.id] = decision;
    const start = decision.branchStart;
    if (start && 'branchStart' in task.target && !task.target.branchStart && /^[0-9a-f]{40}$/i.test(start.sha)
      && start.sourceObservationIds.length && start.sourceObservationIds.every(id => observations.some(o => o.id === id))) {
      task.target.branchStart = clone(start);
    }
    if (decision.prCandidate && 'prBinding' in task.target && !task.target.prBinding
      && observations.some(o => o.id === decision.prCandidate!.sourceObservationId)) {
      task.target.prBinding = clone(decision.prCandidate);
    }
    if (decision.status === 'pass' && task.navigationIntent === 'advance') {
      const index = tutorial.steps.findIndex(s => s.id === step.id);
      const next = tutorial.steps[index + 1];
      if (next) {
        task.frontierStepId = next.id; task.displayStepId = next.id;
        beginRound(task, effects);
        return;
      }
      // 教程最后一项通过后另调终验。交接页必须在本轮重读，不能拿旧 PR tip 完成。
      const checkedPage = fresh.some(o => task.bindings.some(b => b.id === o.pageBindingId && b.pageRole === step.pageRole));
      if (!checkedPage || tutorial.steps.some(s => task.stepChecks[s.id]?.status !== 'pass')) decision = problem('steps-not-verified');
      else decision = check(true);
      if (decision.status === 'pass') {
        stop(task, effects, 'system-verified', true);
        task.result = 'system-verified'; task.decision = decision;
        return;
      }
    }
    task.decision = decision;
    if (decision.status === 'actionable') {
      const located = fresh.filter(o => o.location?.status === 'found' && task.bindings.some(
        b => b.id === o.pageBindingId && b.pageRole === step.pageRole));
      if (located.length === 1) {
        const o = located[0]!, request = requests.get(o.pageBindingId)!.request;
        const guide: ShowGuide = { ...request, type: 'SHOW_GUIDE', leaseMs: LEASE_MS,
          target: o.location?.target ?? step.target, copy: { title: step.title, instruction: step.instruction } };
        effects.push(guide); task.state = 'guiding'; return;
      }
      task.decision = problem(located.length ? 'ambiguous-target' : 'target-unavailable');
      task.state = 'pending';
    } else {
      task.state = ({ pass: 'ready', blocked: 'blocked', wait: 'waiting', unknown: 'pending' } as const)[decision.status];
    }
  }

  async function start(event: Extract<RuntimeEvent, { type: 'USER_START' }>, sender: Extract<TrustedSender, { kind: 'ui' }>): Promise<CommandResult> {
    if (active()) return response('rejected', active(), 'owner-active');
    if (tasks.size >= TASK_LIMIT) return response('rejected', undefined, 'capacity-exceeded');
    const registered = await deps.resolveTutorial(event.tutorialId, event.version);
    if (!registered || registered.identity.id !== event.tutorialId || registered.identity.version !== event.version
        || deps.capabilities.mode !== 'runtime') return response('rejected', undefined, 'unsupported-tutorial');
    const { tutorial, identity } = registered;
    const adapter = deps.capabilities.adapters[tutorial.adapterId];
    if (!adapter || !event.target || tutorial.parameterProfile !== event.target.profile || !adapter.parameterProfiles.includes(event.target.profile)
        || !tutorial.steps.length || !validStart(event.target)) return response('rejected', undefined, 'invalid-target');
    const marker = 'expectedEdit' in event.target ? event.target.expectedEdit.practiceMarker : undefined;
    if (marker && records().some(t => 'expectedEdit' in t.target && t.target.expectedEdit.practiceMarker === marker)) {
      return response('rejected', undefined, 'marker-in-use');
    }
    const taskId = deps.makeId();
    tutorials.set(taskId, tutorial);
    const task: SessionCheckpoint = {
      checkpointSchema: 1, taskId, tutorial: identity, target: clone(event.target), owner: { windowId: sender.windowId, uiInstanceId: sender.uiInstanceId },
      state: 'ready', result: null, endedReason: null, displayStepId: tutorial.steps[0]!.id, frontierStepId: tutorial.steps[0]!.id,
      navigationIntent: 'advance', sessionRevision: 0, contextRevision: 0, evidenceRevision: 0, bindings: [], observations: [],
      stepChecks: {}, decision: null, stopStatus: { epoch: 0, pendingBindings: [], failedBindings: [] }, updatedAt: now(),
    };
    const effects: Effect[] = [];
    beginRound(task, effects);
    return commit(task, effects, true);
  }

  type TaskCommand = Extract<RuntimeEvent, { expectedSessionRevision: number }>;
  async function command(event: TaskCommand, sender: TrustedSender): Promise<CommandResult> {
    const saved = tasks.get(event.taskId);
    if (!saved || saved.state === 'ended' || sender.kind !== 'ui') return response('rejected', saved, 'inactive-task');
    const continuing = event.type === 'USER_CONTINUE' && saved.owner === null;
    const pausedExit = event.type === 'EXIT' && saved.state === 'paused' && owns(previousOwners.get(saved.taskId), sender);
    if (continuing && active()) return response('rejected', saved, 'owner-active');
    if (!continuing && !pausedExit && !owns(saved.owner, sender)) return response('rejected', saved, 'wrong-owner');
    const stopping = event.type === 'USER_PAUSE' || event.type === 'EXIT';
    if (!stopping && event.expectedSessionRevision !== saved.sessionRevision) return response('conflict', saved, 'revision-conflict');
    const task = clone(saved), effects: Effect[] = [];
    if (stopping) {
      stop(task, effects, event.type === 'EXIT' ? 'user-exit' : 'user-paused', event.type === 'EXIT');
    } else {
      if (!tutorials.has(task.taskId)) return response('rejected', saved, 'tutorial-changed');
      if (continuing) {
        task.owner = { windowId: sender.windowId, uiInstanceId: sender.uiInstanceId };
        task.bindings = [];
        task.stopStatus = { epoch: task.stopStatus.epoch, failedBindings: [], pendingBindings: [] };
        task.endedReason = null;
      }
      const tutorial = tutorials.get(task.taskId)!;
      if (event.type === 'USER_BACK') {
        const index = tutorial.steps.findIndex(step => step.id === task.displayStepId);
        task.displayStepId = tutorial.steps[Math.max(0, index - 1)]!.id;
        task.navigationIntent = 'review';
      } else if (event.type === 'USER_ADVANCE' && task.navigationIntent === 'review') {
        task.navigationIntent = 'advance'; task.displayStepId = task.frontierStepId;
      } else if (event.type === 'USER_CONFIRM_ANCHOR') {
        const candidate = task.decision?.commitCandidate;
        const validIds = new Set(currentEvidence(task, now()).map(o => o.id));
        if (!candidate || candidate.sha !== event.sha || !/^[0-9a-f]{40}$/i.test(candidate.sha)
          || !candidate.sourceObservationIds.length || candidate.sourceObservationIds.some(id => !validIds.has(id))) {
          return response('rejected', saved, 'anchor-not-current');
        }
        if (task.target.commitAnchor && task.target.commitAnchor.sha !== candidate.sha) {
          task.target.targetRevision++;
          task.evidenceRevision++;
          task.stepChecks = {};
          task.displayStepId = tutorial.steps[0]!.id; task.frontierStepId = task.displayStepId;
          task.navigationIntent = 'advance';
          if ('prBinding' in task.target) task.target.prBinding = null;
        }
        task.target.commitAnchor = { ...clone(candidate), confirmedAt: now() };
      }
      beginRound(task, effects);
    }
    return commit(task, effects);
  }

  async function pageHello(event: Extract<RuntimeEvent, { type: 'PAGE_HELLO' }>, sender: TrustedSender): Promise<CommandResult> {
    const saved = active(), b = event.binding;
    if (!saved || !samePage(b, sender) || b.windowId !== saved.owner?.windowId || !b.id || !b.objectKey
      || !Number.isSafeInteger(b.navigationRevision) || b.navigationRevision < 0) return response('rejected', saved, 'unbound-page');
    let origin: string;
    try { origin = new URL(b.url).origin; } catch { return response('rejected', saved, 'unbound-page'); }
    if (origin !== b.origin || (saved.target.profile === 'fixture_collaboration_v1' && !saved.target.origins.includes(origin))
        || !deps.capabilities.adapters[tutorials.get(saved.taskId)!.adapterId]?.roles.includes(b.pageRole)) {
      return response('rejected', saved, 'unbound-page');
    }
    const existing = saved.bindings.find(other => other.id === b.id);
    if (existing && (existing.tabId !== b.tabId || existing.documentId !== b.documentId
      || existing.navigationRevision > b.navigationRevision)) return response('rejected', saved, 'stale-binding');
    // 相同文档可反复握手。已经在该对象的最近位置时，重复握手不能制造读写循环。
    const lastForObject = saved.bindings.filter(other => other.pageRole === b.pageRole && other.objectKey === b.objectKey).at(-1);
    if (existing && lastForObject?.id === existing.id && existing.navigationRevision === b.navigationRevision
        && existing.url === b.url && existing.objectKey === b.objectKey && existing.pageRole === b.pageRole) return response('accepted', saved);
    const task = clone(saved), effects: Effect[] = [];
    task.bindings = task.bindings.filter(other => other.tabId !== b.tabId && other.id !== b.id);
    task.bindings.push(clone(b));
    beginRound(task, effects);
    return commit(task, effects);
  }

  async function pageLost(bindingId: string, sender: TrustedSender): Promise<CommandResult> {
    const saved = records().find(task => task.bindings.some(b => b.id === bindingId)
      && (task.owner || task.stopStatus.pendingBindings.includes(bindingId)));
    const b = saved?.bindings.find(item => item.id === bindingId);
    if (!saved || !b || (sender.kind !== 'system' && !samePage(b, sender))) return response('rejected', undefined, 'unbound-page');
    const task = clone(saved), effects: Effect[] = [];
    task.bindings = task.bindings.filter(item => item.id !== b.id);
    if (task.stopStatus.pendingBindings.includes(b.id)) {
      task.stopStatus.pendingBindings = task.stopStatus.pendingBindings.filter(id => id !== b.id);
      task.stopStatus.failedBindings.push(b.id);
    }
    if (task.owner) beginRound(task, effects);
    return commit(task, effects);
  }

  type RequestEvent = Extract<RuntimeEvent, { request: RequestIdentity }>;
  async function pageEvent(event: RequestEvent, sender: TrustedSender): Promise<CommandResult> {
    const req = event.request, saved = tasks.get(req.taskId);
    const b = saved?.bindings.find(item => item.id === req.bindingId), item = requests.get(req.bindingId);
    if (!saved?.owner || !item || !b || !sameRequest(item.request, req) || req.contextRevision !== saved.contextRevision
        || (event.type === 'CHECK_TIMEOUT' ? sender.kind !== 'system' : !samePage(b, sender))) {
      return response('rejected', saved, 'stale-request');
    }
    // 离开页面后不再读取原文档。其他页面仍可用这份记录核对同一笔提交，直到记录过期。
    if (event.type === 'LOCATION_INVALIDATED' && event.reason === 'page-left') return pageLost(b.id, sender);
    const task = clone(saved), effects: Effect[] = [];
    if (event.type === 'LOCATION_INVALIDATED') {
      const bound = task.bindings.find(entry => entry.id === b.id)!;
      bound.navigationRevision++;
      beginRound(task, effects);
      return commit(task, effects);
    }
    if (item.answered) return response('rejected', saved, 'duplicate-result');
    if (event.type === 'CHECK_RESULT') {
      const o = event.observation;
      if (!o || !item.kinds.includes(o.kind) || o.objectKey !== b.objectKey
        || (deps.roleKinds?.[b.pageRole] && deps.roleKinds[b.pageRole] !== o.kind)
        || !['ok', 'unknown', 'read-error'].includes(o.status) || !o.payload || typeof o.payload !== 'object' || Array.isArray(o.payload)) {
        return response('rejected', saved, 'invalid-observation');
      }
      const time = now();
      const observation: Observation = {
        status: o.status, kind: o.kind, objectKey: b.objectKey, payload: clone(o.payload),
        ...(o.reason && { reason: o.reason }), ...(o.location && { location: { ...clone(o.location), bindingId: b.id } }),
        id: deps.makeId(), taskId: task.taskId, targetRevision: task.target.targetRevision, tutorialIdentity: task.tutorial,
        pageBindingId: b.id, documentId: b.documentId, navigationRevision: b.navigationRevision, requestId: req.requestId,
        observedAt: time, expiresAt: time + EVIDENCE_TTL_MS, invalidatedReason: null,
      };
      task.observations.push(observation);
      task.evidenceRevision++;
    }
    item.answered = true; item.cancelTimer?.();
    if (event.type === 'CHECK_TIMEOUT') effects.push({ ...item.request, type: 'CANCEL_REQUEST', reason: 'check-timeout' });
    if ([...requests.values()].every(other => other.answered)) {
      evaluate(task, effects);
      if (task.state === 'pending' && event.type === 'CHECK_TIMEOUT' && !effects.some(e => e.type === 'CHECK_REQUEST')) {
        task.decision = problem('check-timeout');
      }
    }
    return commit(task, effects, event.type === 'CHECK_RESULT');
  }

  async function processEvent(event: RuntimeEvent, sender: TrustedSender): Promise<CommandResult> {
    if ('messageId' in event) {
      if (sender.kind !== 'ui' || event.coordinatorEpoch !== epoch) return response('rejected', undefined, 'wrong-sender-or-epoch');
      const key = JSON.stringify([sender.windowId, sender.uiInstanceId, event.messageId]);
      const previous = replies.get(key);
      if (previous) return clone(previous);
      const reply = event.type === 'USER_START' ? await start(event, sender) : await command(event, sender);
      replies.set(key, clone(reply));
      return reply;
    }
    switch (event.type) {
      case 'UI_LOST': {
        const saved = active();
        if (!saved || !owns(saved.owner, sender)) return response('rejected', saved, 'wrong-owner');
        const task = clone(saved), effects: Effect[] = [];
        stop(task, effects, 'ui-disconnected'); return commit(task, effects);
      }
      case 'PAGE_HELLO': return pageHello(event, sender);
      case 'PAGE_LOST': return pageLost(event.bindingId, sender);
      case 'CHECK_RESULT':
      case 'LOCATION_INVALIDATED':
      case 'CHECK_TIMEOUT': return pageEvent(event, sender);
      case 'STOP_ACK': {
        const saved = tasks.get(event.taskId), b = saved?.bindings.find(item => item.id === event.bindingId);
        if (!saved || !b || !samePage(b, sender) || b.documentId !== event.documentId || event.coordinatorEpoch !== epoch
          || event.contextRevision !== saved.contextRevision || event.stopEpoch !== saved.stopStatus.epoch
          || !saved.stopStatus.pendingBindings.includes(b.id)) return response('rejected', saved, 'stale-stop');
        const task = clone(saved);
        task.stopStatus.pendingBindings = task.stopStatus.pendingBindings.filter(id => id !== b.id);
        if (event.status === 'failed') task.stopStatus.failedBindings.push(b.id);
        return commit(task, []);
      }
    }
  }

  function handle(event: RuntimeEvent, sender: TrustedSender): Promise<CommandResult> {
    return serial(() => processEvent(event, sender));
  }
  async function recover(): Promise<void> {
    await serial(async () => {
      for (const saved of await deps.store.readAll()) {
        if (tasks.has(saved.taskId)) continue;
        const loaded = await deps.resolveTutorial(saved.tutorial.id, saved.tutorial.version);
        if (loaded && sameTutorial(loaded.identity, saved.tutorial) && [saved.displayStepId, saved.frontierStepId].every(
          id => loaded.tutorial.steps.some(step => step.id === id))) tutorials.set(saved.taskId, loaded.tutorial);
        tasks.set(saved.taskId, clone(saved));
        if (saved.state === 'paused' || saved.state === 'ended') continue;
        const task = clone(saved), effects: Effect[] = [];
        stop(task, effects, 'recovery-required');
        task.decision = problem('recovery-required');
        await commit(task, effects);
      }
    });
  }

  return { epoch, handle, recover, snapshots: () => clone(records()),
    snapshot: taskId => {
      const task = taskId === undefined
        ? active() ?? records().sort((a, b) => b.updatedAt - a.updatedAt || b.sessionRevision - a.sessionRevision)[0]
        : tasks.get(taskId);
      return task ? clone(task) : undefined;
    },
  };
}
