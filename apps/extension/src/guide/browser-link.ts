import { browser } from 'wxt/browser';
import { guidePort } from './page-messages.js';
import type { PageCommand, PageResponse, PageSignal } from './page-messages.js';
import type { GuidePage, GuideStatus } from './session.js';

type PagePort = ReturnType<typeof browser.tabs.connect>;
type GuideSession = ReturnType<typeof import('./session.js').createGuideSession>;

export type Binding = { tabId: number; origin: string };
export const bindingKey = (windowId: number) => 'tool-tab:' + windowId;

export async function readActiveBinding(windowId: number): Promise<Binding | undefined> {
  const [tab] = await browser.tabs.query({ windowId, active: true });
  // 没存下点击记录时，只使用浏览器当前愿意给本扩展的标签页地址。
  if (tab?.id === undefined || !tab.url || !/^https?:\/\//.test(tab.url)) return;
  return { tabId: tab.id, origin: new URL(tab.url).origin };
}

function connectPage(port: PagePort, onSignal: (event: PageSignal) => void, disconnected: () => void): GuidePage {
  let lastId = 0;
  const pending = new Map<number, (value: unknown) => void>();
  port.onMessage.addListener((response: PageResponse) => {
    if ('event' in response) {
      onSignal(response.event);
      return;
    }
    const finish = pending.get(response.id);
    pending.delete(response.id);
    finish?.(response.value);
  });
  port.onDisconnect.addListener(() => {
    for (const finish of pending.values()) finish(null);
    pending.clear();
    disconnected();
  });
  function send<Result>(command: PageCommand): Promise<Result> {
    return new Promise((resolve, reject) => {
      const id = ++lastId;
      pending.set(id, value => value === null ? reject(new Error('页面已变化，正在重新连接。')) : resolve(value as Result));
      try {
        port.postMessage({ id, command });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }
  return {
    snapshot: newRound => send({ kind: 'snapshot', newRound }),
    read: queries => send({ kind: 'read', queries }),
    apply: decision => send({ kind: 'apply', decision }),
    verify: (proofs, finish, reveal) => send({ kind: 'verify', proofs, finish, reveal }),
    trackScroll: id => { void send({ kind: 'track-scroll', id }).catch(() => {}); },
    clear: () => { void send({ kind: 'clear' }).catch(() => {}); },
  };
}

export function bindGuide(binding: Binding, windowId: number, session: GuideSession, report: (status: GuideStatus) => void) {
  let closed = false;
  let connection: PagePort | undefined;
  let documentId: string | undefined;
  let lastStyled: string | undefined;
  let generation = 0;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let refresh: ReturnType<typeof setTimeout> | undefined;
  let firstSignal = 0;

  function disconnectPage() {
    generation++;
    clearTimeout(refresh);
    refresh = undefined;
    firstSignal = 0;
    const old = connection;
    connection = undefined;
    session.detach();
    old?.disconnect();
  }

  function onSignal(event: PageSignal) {
    if (event === 'action' || event === 'boundary' || event === 'scroll') {
      if (event !== 'scroll') session.invalidate();
      firstSignal ||= Date.now();
      clearTimeout(refresh);
      refresh = setTimeout(() => {
        refresh = undefined;
        firstSignal = 0;
        void session.refresh('user');
      }, Math.min(200, Math.max(0, 650 - (Date.now() - firstSignal))));
    } else if (refresh === undefined) {
      void session.refresh(event === 'lost' ? 'lost' : 'soft');
    }
  }

  function queueReconnect(wait = 200) {
    clearTimeout(reconnect);
    if (!closed) reconnect = setTimeout(() => { void attach(); }, wait);
  }

  async function attach() {
    if (closed || connection) return;
    // 同源仍有授权。等新文档接入时，用浏览器返回的 documentId 绑定脚本、样式和端口。
    const attempt = ++generation;
    try {
      const tab = await browser.tabs.get(binding.tabId);
      if (attempt !== generation) return;
      if (!tab.active || tab.windowId !== windowId) {
        report({ kind: 'paused', text: '已暂停。切回原来的标签页可继续。' });
        return;
      }
      if (!tab.url || new URL(tab.url).origin !== binding.origin) {
        report({ kind: 'paused', text: '请在要引导的网页点击 WebGuide AI 工具栏图标，然后选择继续。' });
        return;
      }
      if (tab.pendingUrl && tab.pendingUrl !== tab.url) return;
      const [injected] = await browser.scripting.executeScript({ target: { tabId: binding.tabId }, files: ['guide-page.js'] });
      if (attempt !== generation) return;
      const nextDocument = injected?.documentId;
      if (!nextDocument) throw new Error('页面暂时无法连接。');
      const current = await browser.tabs.get(binding.tabId);
      if (attempt !== generation || !current.active || current.url !== tab.url
        || (current.pendingUrl && current.pendingUrl !== current.url)) return;
      if (lastStyled !== nextDocument) {
        await browser.scripting.insertCSS({
          target: { tabId: binding.tabId, documentIds: [nextDocument] }, files: ['assets/page-agent-style.css'],
        });
        if (attempt !== generation) return;
        lastStyled = nextDocument;
      }
      documentId = nextDocument;
      const port = browser.tabs.connect(binding.tabId, { name: guidePort, documentId });
      connection = port;
      const page = connectPage(port, event => {
        if (connection === port) onSignal(event);
      }, () => {
        if (connection === port) {
          disconnectPage();
          queueReconnect();
        }
      });
      void session.attach(page);
    } catch {
      if (generation === attempt) report({ kind: 'paused', text: '页面暂时无法连接。请在网页点击扩展图标后继续。' });
    }
  }

  function onUpdated(tabId: number, change: { status?: string; url?: string }) {
    if (tabId !== binding.tabId) return;
    if (change.status === 'loading') {
      // 旧文档先失效。端口断开后，新文档再接管。
      session.invalidate();
      if (!connection) queueReconnect();
    }
    if ((change.url || change.status === 'complete') && !connection) queueReconnect();
  }

  function onActivated(info: { tabId: number; windowId: number }) {
    if (info.windowId !== windowId) return;
    if (info.tabId === binding.tabId) queueReconnect(0);
    else {
      disconnectPage();
      report({ kind: 'paused', text: '已暂停。切回原来的标签页，或在新网页点击扩展图标后继续。' });
    }
  }

  function onRemoved(tabId: number) {
    if (tabId !== binding.tabId) return;
    disconnectPage();
    report({ kind: 'paused', text: '原标签页已关闭。可在其他网页点击扩展图标后继续。' });
  }

  browser.tabs.onUpdated.addListener(onUpdated);
  browser.tabs.onActivated.addListener(onActivated);
  browser.tabs.onRemoved.addListener(onRemoved);
  void attach();
  return () => {
    closed = true;
    clearTimeout(reconnect);
    disconnectPage();
    browser.tabs.onUpdated.removeListener(onUpdated);
    browser.tabs.onActivated.removeListener(onActivated);
    browser.tabs.onRemoved.removeListener(onRemoved);
  };
}
