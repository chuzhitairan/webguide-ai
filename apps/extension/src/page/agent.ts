import type {
  CheckRequest, Effect, LocationResult, ObservationPayloadResult, PageBinding,
  RequestIdentity, RuntimeEvent, ShowGuide, Stop, TargetSpec, TaskTarget,
} from '@webguide/contracts';
import { createLease, MAX_LEASE_MS } from './lease.js';
import { isVisibleTarget, resolveTarget } from './locator.js';
import { watchPage } from './observer.js';
import { createRenderer, type Renderer } from './renderer.js';

type PageBound = { type: 'PAGE_BOUND'; coordinatorEpoch: string; binding: PageBinding };
export type PageCommand = PageBound | Effect;
export type PageReport = { type: 'PAGE_READY' }
  | Extract<RuntimeEvent, { type: 'CHECK_RESULT' | 'LOCATION_INVALIDATED' | 'STOP_ACK' }>;
export interface PageTransport {
  send(report: PageReport): void;
  onMessage(listener: (message: PageCommand) => void): () => void;
  onDisconnect(listener: () => void): () => void;
}

export interface PageAgentOptions {
  document: Document;
  transport: PageTransport;
  identify(url: string, target?: TaskTarget): { pageRole: string; objectKey: string } | null;
  collect(request: CheckRequest, document: Document): ObservationPayloadResult | Promise<ObservationPayloadResult>;
  resolveLocator?(id: string, document: Document, target: TaskTarget): LocationResult;
  renderer?: Renderer;
}

interface ActiveCheck {
  request: CheckRequest;
  identity: RequestIdentity;
  located?: { spec: TargetSpec; result: LocationResult };
  showing: boolean;
}

// 回复只带身份字段。CHECK_REQUEST 里的目标参数和教程文字不随每份观察往返复制。
function identityOf(request: RequestIdentity): RequestIdentity {
  const {
    coordinatorEpoch, taskId, contextRevision, targetRevision, tutorialIdentity,
    bindingId, documentId, navigationRevision, requestId, checkSequence,
  } = request;
  return {
    coordinatorEpoch, taskId, contextRevision, targetRevision, tutorialIdentity,
    bindingId, documentId, navigationRevision, requestId, checkSequence,
  };
}

function sameRequest(a: RequestIdentity, b: RequestIdentity) {
  return a.coordinatorEpoch === b.coordinatorEpoch && a.taskId === b.taskId
    && a.contextRevision === b.contextRevision && a.targetRevision === b.targetRevision
    && a.bindingId === b.bindingId && a.documentId === b.documentId && a.navigationRevision === b.navigationRevision
    && a.requestId === b.requestId && a.checkSequence === b.checkSequence
    && a.tutorialIdentity.id === b.tutorialIdentity.id && a.tutorialIdentity.version === b.tutorialIdentity.version
    && a.tutorialIdentity.contentHash === b.tutorialIdentity.contentHash;
}

const installed = new WeakMap<Document, { transport: PageTransport; dispose: () => void }>();

// 每个文档只保留一个页面代理。后台授权采集，页面就地核对地址、目标与元素，并可自行撤销授权。
export function startPageAgent(options: PageAgentOptions): () => void {
  const { document, transport } = options;
  const existing = installed.get(document);
  if (existing?.transport === transport) return existing.dispose;
  existing?.dispose();

  const renderer = options.renderer ?? createRenderer();
  const lease = createLease(clearLocal);
  let bound: PageBound | undefined;
  let active: ActiveCheck | undefined;
  let unwatch: (() => void) | undefined;
  let disposed = false;
  let cursor: { taskId: string; revision: number; sequence: number; stopEpoch: number; stopped: boolean } | undefined;

  function clearLocal() {
    active = undefined;
    unwatch?.();
    unwatch = undefined;
    lease.clear();
    renderer.clear();
  }

  function invalidate(reason: Extract<PageReport, { type: 'LOCATION_INVALIDATED' }>['reason']) {
    const identity = active?.identity;
    clearLocal();
    if (identity) transport.send({ type: 'LOCATION_INVALIDATED', request: identity, reason });
  }

  function currentPage(request: CheckRequest) {
    const binding = bound?.binding;
    if (!binding || document.visibilityState === 'hidden' || !document.defaultView
      || document.defaultView !== document.defaultView.top || binding.frameId !== 0
      || request.coordinatorEpoch !== bound?.coordinatorEpoch || request.bindingId !== binding.id
      || request.documentId !== binding.documentId || request.navigationRevision !== binding.navigationRevision
      || binding.url !== document.location.href || binding.origin !== document.location.origin
      || request.targetRevision !== request.target.targetRevision
      || request.pageRole !== binding.pageRole || request.objectKey !== binding.objectKey) return false;
    if (request.target.profile === 'fixture_collaboration_v1' && !request.target.origins.includes(binding.origin)) return false;
    const local = options.identify(document.location.href, request.target);
    return local?.pageRole === binding.pageRole && local.objectKey === binding.objectKey;
  }

  function locate(spec: TargetSpec, request: CheckRequest): LocationResult {
    const registered = (id: string): LocationResult =>
      options.resolveLocator?.(id, document, request.target) ?? { status: 'unavailable' };
    const result = 'css' in spec ? resolveTarget(spec, document) : registered(spec.locatorId);
    // 注册定位器也必须返回当前文档中可见的元素。
    if (result.status === 'found' && !isVisibleTarget(result.element, document)) return { status: 'unavailable' };
    if (result.status === 'found' && 'css' in spec && 'locatorId' in request.targetSpec) {
      // 提交弹窗可能仍有同一个“确认”按钮，但去向已切到新分支。每次复核都要重读定位依据。
      const preferred = registered(request.targetSpec.locatorId);
      if (preferred.status !== 'found' || preferred.element !== result.element) return { status: 'unavailable' };
    }
    return result;
  }

  function validateTarget() {
    const current = active;
    if (!current || !lease.live()) return;
    if (!currentPage(current.request)) {
      invalidate('page-left');
      return;
    }
    if (!current.located) return;
    const previous = current.located.result;
    const next = locate(current.located.spec, current.request);
    if (previous.status !== next.status
      || (previous.status === 'found' && next.status === 'found' && previous.element !== next.element)) {
      invalidate('target-changed');
    }
  }

  async function collect(request: CheckRequest) {
    if (!currentPage(request)) return;
    const sameTask = cursor?.taskId === request.taskId;
    if (cursor && sameTask && (request.contextRevision < cursor.revision
      || (request.contextRevision === cursor.revision && (cursor.stopped || request.checkSequence <= cursor.sequence)))) return;
    if (cursor && !sameTask && !cursor.stopped) return;
    clearLocal();
    cursor = {
      taskId: request.taskId, revision: request.contextRevision, sequence: request.checkSequence,
      stopped: false, stopEpoch: sameTask ? cursor!.stopEpoch : -1,
    };
    const current: ActiveCheck = { request, identity: identityOf(request), showing: false };
    active = current;
    lease.grant(MAX_LEASE_MS);
    unwatch = watchPage(document, validateTarget, invalidate);
    let result: ObservationPayloadResult;
    try {
      result = await options.collect(request, document);
    } catch {
      result = { status: 'read-error', kind: request.checkerId, objectKey: request.objectKey, payload: {}, reason: 'collection-failed' };
    }
    // 异步采集期间用户可能已暂停、导航或切到新步骤。迟到回复不能产生证据。
    if (current !== active || !lease.live() || !currentPage(request)) return;
    const spec = result.location?.target ?? request.targetSpec;
    const found = result.location && result.location.status !== 'found'
      ? { status: result.location.status } : locate(spec, request);
    current.located = { spec, result: found };
    transport.send({
      type: 'CHECK_RESULT', request: current.identity,
      observation: { ...result, location: { status: found.status, target: spec, bindingId: request.bindingId } },
    });
  }

  function show(command: ShowGuide) {
    const current = active;
    if (!current || !sameRequest(command, current.identity) || !lease.live()) return;
    validateTarget();
    if (active !== current || current.located?.result.status !== 'found') return;
    const result = locate(command.target, current.request);
    if (result.status !== 'found' || result.element !== current.located.result.element) return;
    // 续租只能延长已核对的这一项。重新创建提示会抢走输入焦点，也会掩盖目标已被替换。
    lease.grant(command.leaseMs);
    if (active !== current || current.showing) return;
    renderer.show(result.element, command.copy);
    current.showing = true;
  }

  function stop(command: Stop) {
    if (!bound || command.coordinatorEpoch !== bound.coordinatorEpoch || command.bindingId !== bound.binding.id
      || command.documentId !== bound.binding.documentId || (cursor && (cursor.taskId !== command.taskId
        || command.contextRevision < cursor.revision || command.stopEpoch < cursor.stopEpoch))) return;
    clearLocal();
    cursor = { taskId: command.taskId, revision: command.contextRevision, sequence: -1, stopped: true, stopEpoch: command.stopEpoch };
    transport.send({
      type: 'STOP_ACK', coordinatorEpoch: command.coordinatorEpoch, taskId: command.taskId,
      contextRevision: command.contextRevision, bindingId: command.bindingId, documentId: command.documentId,
      stopEpoch: command.stopEpoch, status: 'stopped',
    });
  }

  const unsubscribe = transport.onMessage(command => {
    if (disposed) return;
    switch (command.type) {
      case 'PAGE_BOUND': {
        const binding = command.binding;
        if (bound?.coordinatorEpoch === command.coordinatorEpoch && bound.binding.id === binding.id
          && bound.binding.documentId === binding.documentId && bound.binding.navigationRevision === binding.navigationRevision
          && bound.binding.url === binding.url) return;
        clearLocal();
        if (bound?.coordinatorEpoch !== command.coordinatorEpoch) cursor = undefined;
        bound = command;
        break;
      }
      case 'CHECK_REQUEST': void collect(command); break;
      case 'SHOW_GUIDE': show(command); break;
      case 'CANCEL_REQUEST': if (active && sameRequest(command, active.identity)) clearLocal(); break;
      case 'STOP': stop(command); break;
    }
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearLocal();
    unsubscribe();
    removeDisconnect();
    installed.delete(document);
  }

  const removeDisconnect = transport.onDisconnect(dispose);
  installed.set(document, { transport, dispose });
  transport.send({ type: 'PAGE_READY' });
  return dispose;
}
