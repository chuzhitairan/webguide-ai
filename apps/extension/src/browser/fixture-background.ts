import { browser } from 'wxt/browser';
import { loadTutorial, parseEnvelope } from '@webguide/contracts';
import type { Effect, Envelope, PageBinding, SessionCheckpoint, TrustedSender } from '@webguide/contracts';
import tutorialText from '../../../../tests/fixtures/collaboration/tutorial.json?raw';
import { fixtureCapabilities } from '../../../../tests/fixtures/collaboration/capabilities.js';
import { makeFixtureTarget } from '../../../../tests/fixtures/collaboration/cases.js';
import { fixtureRoleKinds, identifyFixtureUrl } from '../adapters/fixture-collaboration/capabilities.js';
import { evaluateFixtureCollaboration } from '../adapters/fixture-collaboration/verify.js';
import { createCoordinator } from '../runtime/coordinator.js';
import { createSessionStore } from './session-store.js';
import { getPageSender, getUiWindow, parsePageReport, parseUiCommand, wire } from './message-router.js';
import { injectFixtureAgent, registerFixtureAgent, removeFixtureAgent } from './injection.js';
import { fixtureHostGranted } from './permissions.js';
import type { PanelState } from '../sidepanel/session-client.js';

type Port = Parameters<Parameters<typeof browser.runtime.onConnect.addListener>[0]>[0];
type PageSender = Extract<TrustedSender, { kind: 'page' }>;
type UiSender = Extract<TrustedSender, { kind: 'ui' }>;

type PageConnection = { port: Port; sender: PageSender; binding: PageBinding | null };
const inactive = new Set(['paused', 'ended', 'ready']);

function post(port: Port, envelope: Envelope): void {
  try {
    port.postMessage(envelope);
  } catch {
    // Browsers can tear down a document between checking it and sending.
  }
}

export function startFixtureBackground(openedWindows: Set<number>): void {
  const tutorial = loadTutorial(tutorialText, fixtureCapabilities);
  const uiPorts = new Map<Port, UiSender>();
  const pages = new Map<number, PageConnection>();
  let registration: Promise<void> | undefined;

  const coordinator = createCoordinator({
    store: createSessionStore({
      get: () => browser.storage.session.get(null),
      set: values => browser.storage.session.set(values),
      remove: key => browser.storage.session.remove(key),
    }),
    clock: { now: Date.now },
    makeId: () => crypto.randomUUID(),
    capabilities: fixtureCapabilities,
    roleKinds: fixtureRoleKinds,
    evaluate: evaluateFixtureCollaboration,
    async resolveTutorial(id, version) {
      const loaded = await tutorial;
      return loaded.ok && loaded.identity.id === id && loaded.identity.version === version ? loaded : undefined;
    },
    emit: sendEffect,
    publish: async snapshot => {
      await Promise.all([...uiPorts.keys()].map(port => publishTo(port, snapshot)));
      if (snapshot.state === 'paused' || snapshot.state === 'ended') {
        registration = undefined;
        await removeFixtureAgent().catch(() => {});
      }
    },
  });
  const recovered = coordinator.recover();

  async function publishTo(port: Port, checkpoint?: SessionCheckpoint): Promise<void> {
    const loaded = await tutorial;
    const snapshot = checkpoint ? {
      taskId: checkpoint.taskId, tutorial: checkpoint.tutorial, target: checkpoint.target,
      state: checkpoint.state, result: checkpoint.result, endedReason: checkpoint.endedReason,
      displayStepId: checkpoint.displayStepId, frontierStepId: checkpoint.frontierStepId,
      navigationIntent: checkpoint.navigationIntent, sessionRevision: checkpoint.sessionRevision,
      contextRevision: checkpoint.contextRevision, decision: checkpoint.decision, stopStatus: checkpoint.stopStatus,
    } : null;
    const steps = loaded.ok ? loaded.tutorial.steps : [];
    const stepIndex = checkpoint ? steps.findIndex(step => step.id === checkpoint.displayStepId) : -1;
    const cited = new Set(snapshot?.decision?.evidenceIds ?? []);
    const evidenceTime = Math.max(0, ...(checkpoint?.observations ?? [])
      .filter(observation => cited.has(observation.id)).map(observation => observation.observedAt));
    const view: PanelState = {
      snapshot, step: steps[stepIndex] ?? null, stepIndex: stepIndex + 1, stepCount: steps.length,
      evidenceTime: evidenceTime || null,
    };
    post(port, wire('SESSION_SNAPSHOT', { view }, { coordinatorEpoch: coordinator.epoch }));
  }

  function sendEffect(effect: Effect): void {
    const connection = [...pages.values()].find(({ binding }) => binding?.id === effect.bindingId);
    if (!connection || connection.sender.documentId !== effect.documentId) return;
    if (effect.type === 'CHECK_REQUEST' && connection.binding) {
      // Rebinding tells the page which document and navigation revision it
      // may use before a check can read or highlight anything.
      connection.binding = { ...connection.binding, navigationRevision: effect.navigationRevision };
      post(connection.port, wire('HELLO_ACK', { binding: connection.binding }, { coordinatorEpoch: coordinator.epoch }));
    }
    post(connection.port, wire(effect.type, { effect }, {
      coordinatorEpoch: effect.coordinatorEpoch, taskId: effect.taskId, contextRevision: effect.contextRevision,
    }));
  }

  function failure(port: Port, text: string): void {
    post(port, wire('ERROR', { text }, { coordinatorEpoch: coordinator.epoch }));
  }

  function activeFor(windowId: number) {
    const snapshot = coordinator.snapshot();
    return snapshot?.owner?.windowId === windowId && !inactive.has(snapshot.state)
      && snapshot.target.profile === 'fixture_collaboration_v1' ? snapshot : undefined;
  }

  async function bindPage(connection: PageConnection): Promise<void> {
    const snapshot = activeFor(connection.sender.windowId);
    if (!snapshot || snapshot.target.profile !== 'fixture_collaboration_v1' || !await fixtureHostGranted()) return;
    const tab = await browser.tabs.get(connection.sender.tabId);
    if (!tab.active || !tab.url || pages.get(connection.sender.tabId) !== connection) return;
    const route = identifyFixtureUrl(tab.url, snapshot.target);
    if (!route) return;
    connection.sender = { ...connection.sender, url: tab.url };
    const bindingId = connection.sender.tabId + ':' + connection.sender.documentId;
    const old = connection.binding;
    const binding: PageBinding = {
      id: bindingId, tabId: connection.sender.tabId, windowId: connection.sender.windowId, frameId: 0,
      documentId: connection.sender.documentId, url: tab.url, origin: route.origin, pageRole: route.pageRole,
      objectKey: route.objectKey, navigationRevision: (old?.navigationRevision ?? 0) + (old && old.url !== tab.url ? 1 : 0),
    };
    connection.binding = binding;
    post(connection.port, wire('HELLO_ACK', { binding }, { coordinatorEpoch: coordinator.epoch }));
    await coordinator.handle({ type: 'PAGE_HELLO', binding }, connection.sender);
  }

  async function checkActiveTab(windowId: number): Promise<void> {
    const snapshot = activeFor(windowId);
    if (!snapshot || snapshot.target.profile !== 'fixture_collaboration_v1' || !await fixtureHostGranted()) return;
    registration ??= registerFixtureAgent().catch(error => { registration = undefined; throw error; });
    await registration;
    const [active] = await browser.tabs.query({ active: true, windowId });
    if (!active?.url || typeof active.id !== 'number' || !identifyFixtureUrl(active.url, snapshot.target)) return;
    const existing = pages.get(active.id);
    if (existing) {
      await bindPage(existing);
    } else {
      await injectFixtureAgent(active.id);
    }
  }

  async function nativePanelWindow(port: Port): Promise<number | undefined> {
    if (!port.sender?.documentId || typeof browser.runtime.getContexts !== 'function') return;
    const contexts = await browser.runtime.getContexts({ documentIds: [port.sender.documentId] });
    const context = contexts.find(value => String(value.contextType) === 'SIDE_PANEL');
    if (context && openedWindows.delete(context.windowId)) return context.windowId;
  }

  function connectUi(port: Port): void {
    let closed = false;
    port.onDisconnect.addListener(() => {
      closed = true;
      const sender = uiPorts.get(port);
      uiPorts.delete(port);
      if (sender) void recovered.then(() => coordinator.handle({ type: 'UI_LOST' }, sender)).catch(() => {});
    });
    let queue: Promise<void> = Promise.resolve();
    port.onMessage.addListener(raw => {
      queue = queue.then(async () => {
        await recovered;
        if (closed) return;
        const parsed = parseEnvelope(raw);
        if (!parsed.ok || !port.sender) return;
        const envelope = parsed.envelope;
        const sender = uiPorts.get(port);
        if (envelope.type === 'UI_HELLO' && !sender) {
          const nativeWindow = port.sender.tab ? undefined : await nativePanelWindow(port);
          const windowId = getUiWindow(port.sender, browser.runtime.id, __WEBGUIDE_FIXTURE__, nativeWindow);
          const instance = envelope.payload.uiInstanceId;
          if (windowId === undefined || typeof instance !== 'string' || !instance || closed) {
            failure(port, '请用浏览器工具栏打开侧栏。');
            return;
          }
          uiPorts.set(port, { kind: 'ui', uiInstanceId: instance, windowId });
          post(port, wire('HELLO_ACK', {}, { coordinatorEpoch: coordinator.epoch }));
          await publishTo(port, coordinator.snapshot());
          return;
        }
        if (!sender) return;
        const command = parseUiCommand(envelope, makeFixtureTarget);
        if (!command) return;
        const result = await coordinator.handle(command, sender);
        if (result.status !== 'accepted') {
          failure(port, result.status === 'conflict' ? '页面进度已更新，请根据最新状态操作。' : '当前操作无法继续：' + (result.reason ?? '请重新核对'));
          await publishTo(port, result.snapshot ?? coordinator.snapshot());
        } else if (command.type === 'USER_START' || command.type === 'USER_CONTINUE') {
          await checkActiveTab(sender.windowId);
        }
      }).catch(() => failure(port, '连接或页面读取失败，请打开练习页后重新核对。'));
    });
  }

  function connectPage(port: Port): void {
    const reported = port.sender;
    if (!reported?.tab || typeof reported.tab.windowId !== 'number' || !reported.documentId) return;
    const sender = getPageSender(reported, browser.runtime.id, reported.tab.windowId, reported.documentId);
    if (!sender || !identifyFixtureUrl(sender.url)) return;
    const connection: PageConnection = { port, sender, binding: null };
    pages.set(sender.tabId, connection);
    port.onDisconnect.addListener(() => {
      if (pages.get(sender.tabId) === connection) pages.delete(sender.tabId);
      const binding = connection.binding;
      if (binding) void recovered.then(() => coordinator.handle({ type: 'PAGE_LOST', bindingId: binding.id }, connection.sender)).catch(() => {});
    });
    let queue: Promise<void> = Promise.resolve();
    port.onMessage.addListener(raw => {
      queue = queue.then(async () => {
        await recovered;
        if (pages.get(sender.tabId) !== connection) return;
        const parsed = parseEnvelope(raw);
        if (!parsed.ok) return;
        const envelope = parsed.envelope;
        if (envelope.type === 'PAGE_HELLO') return bindPage(connection);
        const report = parsePageReport(envelope);
        if (!report || !connection.binding) return;
        await coordinator.handle(report, connection.sender);
      }).catch(() => {});
    });
  }

  // Register browser listeners synchronously, including on service-worker restart.
  browser.runtime.onConnect.addListener(port => {
    if (port.name === 'webguide-ui') connectUi(port);
    if (port.name === 'webguide-page') connectPage(port);
  });
  browser.tabs.onActivated.addListener(({ windowId }) => {
    void recovered.then(() => checkActiveTab(windowId)).catch(() => {});
  });
  browser.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (tab.active && (change.status === 'complete' || (change.url && tab.status === 'complete'))) {
      void recovered.then(() => checkActiveTab(tab.windowId)).catch(() => {});
    }
  });
  browser.permissions.onRemoved.addListener(() => {
    void fixtureHostGranted().then(granted => {
      if (granted) return;
      void removeFixtureAgent().catch(() => {});
      for (const page of pages.values()) page.port.disconnect();
      for (const sender of uiPorts.values()) void coordinator.handle({ type: 'UI_LOST' }, sender);
    }).catch(() => {});
  });
}
