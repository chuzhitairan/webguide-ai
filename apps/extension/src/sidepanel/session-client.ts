import { browser } from 'wxt/browser';
import { isRecord, parseEnvelope } from '@webguide/contracts';
import type { MessageType, SessionCheckpoint, TutorialStep } from '@webguide/contracts';
import { wire } from '../browser/message-router.js';

export interface PanelState {
  snapshot: Pick<SessionCheckpoint, 'taskId' | 'tutorial' | 'target' | 'state' | 'result' | 'endedReason'
    | 'displayStepId' | 'frontierStepId' | 'navigationIntent' | 'sessionRevision' | 'contextRevision' | 'decision' | 'stopStatus'>
    | null;
  step: TutorialStep | null;
  stepIndex: number;
  stepCount: number;
  evidenceTime: number | null;
}

export function connectSession(update: (state: PanelState) => void, status: (message: string) => void) {
  const port = browser.runtime.connect({ name: 'webguide-ui' });
  let coordinatorEpoch: string | undefined;
  let snapshot: PanelState['snapshot'] = null;
  let disposed = false;
  port.onMessage.addListener(raw => {
    const parsed = parseEnvelope(raw);
    if (!parsed.ok) return;
    const envelope = parsed.envelope;
    if (envelope.type === 'HELLO_ACK') {
      coordinatorEpoch = envelope.coordinatorEpoch;
      status('');
    } else if (envelope.type === 'SESSION_SNAPSHOT' && isRecord(envelope.payload.view)) {
      const view = envelope.payload.view as unknown as PanelState;
      snapshot = view.snapshot;
      update(view);
    } else if (envelope.type === 'ERROR' && typeof envelope.payload.text === 'string') {
      status(envelope.payload.text);
    }
  });
  port.onDisconnect.addListener(() => {
    coordinatorEpoch = undefined;
    if (!disposed) status('连接已断开。请重新打开侧栏，再核对任务。');
  });
  port.postMessage(wire('UI_HELLO', { uiInstanceId: crypto.randomUUID() }));

  return {
    send(type: MessageType, payload: Record<string, unknown> = {}) {
      if (!coordinatorEpoch) return;
      status('');
      if (type === 'USER_START') {
        port.postMessage(wire(type, payload, { coordinatorEpoch }));
      } else if (snapshot) {
        port.postMessage(wire(type, { ...payload, expectedSessionRevision: snapshot.sessionRevision }, {
          coordinatorEpoch, taskId: snapshot.taskId, contextRevision: snapshot.contextRevision,
        }));
      }
    },
    dispose() {
      disposed = true;
      port.disconnect();
    },
  };
}