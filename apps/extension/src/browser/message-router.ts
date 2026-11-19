import { isRecord, PROTOCOL_VERSION } from '@webguide/contracts';
import type { Envelope, FixtureCollaborationTarget, MessageType, RuntimeEvent, TrustedSender } from '@webguide/contracts';

interface BrowserSender {
  id?: string;
  url?: string;
  documentId?: string;
  frameId?: number;
  tab?: { id?: number; windowId?: number };
}

export function getUiWindow(sender: BrowserSender, extensionId: string, testBuild: boolean, nativeWindow?: number): number | undefined {
  if (sender.id !== extensionId || sender.url !== 'chrome-extension://' + extensionId + '/sidepanel.html') return;
  if (sender.tab && testBuild && typeof sender.tab.id === 'number' && typeof sender.tab.windowId === 'number') {
    return sender.tab.windowId;
  }
  if (!sender.tab) return nativeWindow;
}

export function getPageSender(
  sender: BrowserSender, extensionId: string, windowId: number, documentId: string, currentUrl?: string,
): Extract<TrustedSender, { kind: 'page' }> | undefined {
  if (sender.id !== extensionId || sender.frameId !== 0 || !sender.tab
    || typeof sender.tab.id !== 'number' || sender.tab.windowId !== windowId
    || typeof sender.documentId !== 'string' || sender.documentId !== documentId || !sender.url) return;
  return { kind: 'page', tabId: sender.tab.id, windowId, frameId: 0, documentId, url: currentUrl ?? sender.url };
}

export function wire(
  type: MessageType, payload: Record<string, unknown>, scope?: Pick<Envelope, 'coordinatorEpoch' | 'taskId' | 'contextRevision'>,
): Envelope {
  return { protocolVersion: PROTOCOL_VERSION, type, messageId: crypto.randomUUID(), payload, ...scope };
}

const uiCommands = new Set(['USER_CONTINUE', 'USER_RECHECK', 'USER_BACK', 'USER_ADVANCE', 'USER_PAUSE', 'EXIT', 'USER_CONFIRM_ANCHOR']);

export function parseUiCommand(envelope: Envelope, fixtureTarget: () => FixtureCollaborationTarget): RuntimeEvent | undefined {
  const { type, taskId, coordinatorEpoch, messageId, payload } = envelope;
  if (!coordinatorEpoch) return;
  if (type === 'USER_START') {
    if (typeof payload.tutorialId !== 'string' || typeof payload.version !== 'string') return;
    const target = fixtureTarget();
    const marker = payload.practiceMarker;
    // The side panel confirms a task identifier. The extension constructs the
    // repo, branch and editable file itself, so UI messages cannot widen scope.
    if (typeof marker !== 'string' || !/^WG-FIXTURE-[A-Z0-9-]{3,50}$/.test(marker)) return;
    target.expectedEdit = { ...target.expectedEdit, practiceMarker: marker, after: '已完成协作练习 ' + marker + '。' };
    return { type, coordinatorEpoch, messageId, tutorialId: payload.tutorialId, version: payload.version, target };
  }
  if (!uiCommands.has(type) || !taskId || !Number.isSafeInteger(payload.expectedSessionRevision)) return;
  const command = { taskId, coordinatorEpoch, messageId, expectedSessionRevision: Number(payload.expectedSessionRevision) };
  if (type === 'USER_CONFIRM_ANCHOR') {
    return typeof payload.sha === 'string' && /^[a-f0-9]{40}$/.test(payload.sha) ? { type, sha: payload.sha, ...command } : undefined;
  }
  return { type, ...command } as RuntimeEvent;
}

export function parsePageReport(envelope: Envelope): RuntimeEvent | undefined {
  const report = envelope.payload.report;
  if (!isRecord(report)) return;
  if (envelope.type === 'STOP_ACK' && report.type === 'STOP_ACK'
    && report.coordinatorEpoch === envelope.coordinatorEpoch && report.taskId === envelope.taskId
    && report.contextRevision === envelope.contextRevision && typeof report.bindingId === 'string'
    && typeof report.documentId === 'string' && Number.isSafeInteger(report.stopEpoch)
    && (report.status === 'stopped' || report.status === 'failed')) return report as unknown as RuntimeEvent;
  if (!isRecord(report.request) || report.request.coordinatorEpoch !== envelope.coordinatorEpoch
    || report.request.taskId !== envelope.taskId || report.request.contextRevision !== envelope.contextRevision
    || typeof report.request.bindingId !== 'string' || typeof report.request.documentId !== 'string'
    || typeof report.request.requestId !== 'string' || !Number.isSafeInteger(report.request.checkSequence)
    || !Number.isSafeInteger(report.request.navigationRevision) || !Number.isSafeInteger(report.request.targetRevision)
    || !isRecord(report.request.tutorialIdentity)) return;
  if (envelope.type === 'LOCATION_INVALIDATED' && report.type === 'LOCATION_INVALIDATED'
    && (report.reason === 'page-left' || report.reason === 'target-changed')) return report as unknown as RuntimeEvent;
  if (envelope.type === 'OBSERVATION' && report.type === 'CHECK_RESULT' && isRecord(report.observation)
    && ['ok', 'unknown', 'read-error'].includes(String(report.observation.status))
    && typeof report.observation.kind === 'string' && typeof report.observation.objectKey === 'string'
    && isRecord(report.observation.payload)) return report as unknown as RuntimeEvent;
}
