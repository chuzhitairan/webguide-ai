import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { browser } from 'wxt/browser';
import { isRecord, parseEnvelope } from '@webguide/contracts';
import { collectFixture } from '../src/adapters/fixture-collaboration/collect.js';
import { identifyFixtureUrl } from '../src/adapters/fixture-collaboration/capabilities.js';
import { resolveFixtureTarget } from '../src/adapters/fixture-collaboration/locators.js';
import { startPageAgent } from '../src/page/agent.js';
import type { PageCommand, PageReport, PageTransport } from '../src/page/agent.js';
import { wire } from '../src/browser/message-router.js';

const installed = Symbol.for('webguide.page-agent');

export default defineUnlistedScript(() => {
  if (!__WEBGUIDE_FIXTURE__ || !identifyFixtureUrl(document.location.href)) return;
  const world = globalThis as typeof globalThis & { [installed]?: () => void };
  if (world[installed]) return;

  const port = browser.runtime.connect({ name: 'webguide-page' });
  const transport: PageTransport = {
    onMessage(listener) {
      const receive = (raw: unknown) => {
        const result = parseEnvelope(raw);
        if (!result.ok) return;
        const { type, payload, coordinatorEpoch } = result.envelope;
        if (type === 'HELLO_ACK' && coordinatorEpoch && isRecord(payload.binding)) {
          listener({ type: 'PAGE_BOUND', coordinatorEpoch, binding: payload.binding } as unknown as PageCommand);
        } else if (isRecord(payload.effect) && type === payload.effect.type) {
          listener(payload.effect as unknown as PageCommand);
        }
      };
      port.onMessage.addListener(receive);
      return () => port.onMessage.removeListener(receive);
    },
    onDisconnect(listener) {
      port.onDisconnect.addListener(listener);
      return () => port.onDisconnect.removeListener(listener);
    },
    send(report: PageReport) {
      if (report.type === 'PAGE_READY') {
        port.postMessage(wire('PAGE_HELLO', {}));
        return;
      }
      const scope = report.type === 'STOP_ACK' ? report : report.request;
      const type = report.type === 'CHECK_RESULT' ? 'OBSERVATION' : report.type;
      port.postMessage(wire(type, { report }, {
        coordinatorEpoch: scope.coordinatorEpoch, taskId: scope.taskId, contextRevision: scope.contextRevision,
      }));
    },
  };

  const dispose = startPageAgent({
    document, transport,
    identify: (url, target) => identifyFixtureUrl(url, target?.profile === 'fixture_collaboration_v1' ? target : undefined),
    collect: collectFixture,
    resolveLocator: (id, doc, target) => resolveFixtureTarget(id, doc, target.profile === 'fixture_collaboration_v1' ? target : undefined),
  });
  world[installed] = dispose;
  port.onDisconnect.addListener(() => { delete world[installed]; });
});
