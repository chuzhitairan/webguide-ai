import { browser } from 'wxt/browser';
import { bindGoal, goalMessages, isGoalPage } from './goal-scope.js';
import type { BoundGoal, Goal, ModelRequest, ModelResponse, PageCommand, PageUpdate } from './protocol.js';

type Tab = { id?: number; windowId: number; url?: string; pendingUrl?: string; status?: string; active: boolean };
type Port = ReturnType<typeof browser.tabs.connect>;
export type NavigationStatus = { text: string; done?: boolean };

export function startNavigation(requestedGoal: Goal, token: string, report: (status: NavigationStatus) => void): () => void {
  const messages = goalMessages(requestedGoal);
  let stopped = false;
  let initialTab: Tab | undefined;
  let goal: BoundGoal | undefined;
  let port: Port | undefined;
  let attachment = 0;
  let requestNumber = 0;
  let pageRevision: number | undefined;
  let pageNotice = '';
  let returnHint: string | undefined;
  let styledDocument: string | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;

  function show(text: string) {
    report({ text });
  }

  function outsideGoal() {
    show(returnHint ?? messages.outside);
  }

  function disconnect() {
    clearTimeout(finishTimer);
    finishTimer = undefined;
    ++attachment;
    ++requestNumber;
    pageRevision = undefined;
    pageNotice = '';
    const previous = port;
    port = undefined;
    previous?.disconnect();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    disconnect();
    browser.tabs.onUpdated.removeListener(onUpdated);
    browser.tabs.onActivated.removeListener(onActivated);
    browser.tabs.onRemoved.removeListener(onRemoved);
  }

  async function attach(tab: Tab) {
    const tabId = tab.id;
    if (stopped || !goal || !tab.active || tabId === undefined || tabId !== initialTab?.id) return;
    disconnect();
    const currentAttachment = attachment;
    if (tab.pendingUrl && tab.pendingUrl !== tab.url) {
      show('网页正在加载，引导会继续。');
      return;
    }
    if (!isGoalPage(tab.url, goal)) {
      outsideGoal();
      return;
    }
    show('正在查看新页面…');
    try {
      const [injected] = await browser.scripting.executeScript({ target: { tabId }, files: ['navigation-agent.js'] });
      if (attachment !== currentAttachment) return;
      const documentId = injected?.documentId;
      if (!documentId) throw new Error('Missing document ID');
      if (styledDocument !== documentId) {
        await browser.scripting.insertCSS({
          target: { tabId, documentIds: [documentId] }, files: ['assets/page-agent-style.css'],
        });
        if (attachment !== currentAttachment) return;
        styledDocument = documentId;
      }
      const current = await browser.tabs.get(tabId);
      if (attachment !== currentAttachment || !current.active || current.url !== tab.url
        || (current.pendingUrl && current.pendingUrl !== current.url)) return;
      const connection = browser.tabs.connect(tabId, { name: 'webguide-navigation', documentId });
      port = connection;
      connection.onMessage.addListener((update: PageUpdate) => {
        void receive(connection, update);
      });
      connection.onDisconnect.addListener(() => {
        if (port === connection) {
          if (finishTimer !== undefined) {
            stop();
            return;
          }
          disconnect();
          show('页面连接已断开。请重新开始引导。');
        }
      });
      const command: PageCommand = { kind: 'observe', goal };
      connection.postMessage(command);
    } catch {
      if (attachment === currentAttachment) show('无法读取当前网页。请在目标页面点击工具栏的 WebGuide AI 后重试。');
    }
  }

  async function receive(connection: Port, update: PageUpdate) {
    if (port !== connection || !goal || finishTimer !== undefined) return;
    if (update.kind === 'displayed') {
      if (pageRevision !== update.revision) return;
      const text = (update.feedback?.prefix ?? pageNotice) + update.instruction;
      if (update.feedback?.complete) {
        // 找位置的任务在目标被标出时完成。留一点时间让用户看清，再撤下网页上的指引。
        finishTimer = setTimeout(stop, 4000);
        report({ text, done: true });
        return;
      }
      show(text);
      return;
    }
    const currentRequest = ++requestNumber;
    if (update.kind === 'observing') {
      pageRevision = undefined;
      pageNotice = '';
      show('正在查看新页面…');
      return;
    }
    if (update.kind === 'outside') {
      pageRevision = undefined;
      outsideGoal();
      return;
    }
    pageRevision = update.revision;
    const { progress } = update;
    if (progress.kind !== 'guide') {
      if (progress.kind === 'finished') {
        stop();
        report({ text: progress.text, done: true });
      } else show(progress.text);
      return;
    }
    pageNotice = progress.notice ?? '';
    returnHint = progress.returnHint ?? returnHint;
    if (update.page.path.length > 300 || update.page.path.startsWith('//')) {
      show('当前页面地址过长或格式不受支持。请回到本次引导的页面后重试。');
      return;
    }
    if (!update.page.controls.length) {
      show(pageNotice + messages.empty);
      return;
    }
    if (!update.review) show(pageNotice + 'AI 正在查看当前页面…');
    const request: ModelRequest = {
      kind: 'choose-navigation', token,
      goal: progress.prompt,
      page: update.page,
      review: update.review,
    };
    const keepGuide: PageCommand = { kind: 'decision', revision: update.revision, decision: { kind: 'keep' } };
    try {
      const response = await browser.runtime.sendMessage(request) as ModelResponse;
      // 两次观察即使在同一个标签页，回包顺序也可能颠倒。
      if (port !== connection || requestNumber !== currentRequest) return;
      if ('error' in response) {
        if (update.review) connection.postMessage(keepGuide);
        else show(pageNotice + response.error);
        return;
      }
      const command: PageCommand = { kind: 'decision', revision: update.revision, decision: response.decision };
      connection.postMessage(command);
    } catch {
      if (port === connection && requestNumber === currentRequest) {
        if (update.review) {
          try { connection.postMessage(keepGuide); } catch { /* 页面已经断开。 */ }
        }
        else show(pageNotice + '暂时无法获取导航建议，请重新开始引导。');
      }
    }
  }

  function onUpdated(id: number, change: { status?: string; url?: string }, tab: Tab) {
    if (id !== initialTab?.id || !tab.active || (!change.status && !change.url)) return;
    if (finishTimer !== undefined) {
      if (change.status === 'loading' || change.url) stop();
      return;
    }
    // 页面可操作时就可以引导，无需等待图片等资源。完整跳转时换到新文档。
    if (change.status === 'loading' || !port) void attach(tab);
  }

  function onActivated(event: { tabId: number; windowId: number }) {
    if (!initialTab || event.windowId !== initialTab.windowId) return;
    if (finishTimer !== undefined) {
      stop();
      return;
    }
    if (event.tabId === initialTab.id) {
      void browser.tabs.get(event.tabId).then(attach, () => stop());
    } else {
      disconnect();
      show('引导已暂停。回到原来的标签页即可继续。');
    }
  }

  function onRemoved(id: number) {
    if (id !== initialTab?.id) return;
    if (finishTimer !== undefined) {
      stop();
      return;
    }
    stop();
    show('引导标签页已关闭。');
  }

  void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (stopped) return;
    goal = bindGoal(tab?.url, requestedGoal);
    if (!goal || tab?.id === undefined) {
      show(messages.start);
      return;
    }
    initialTab = tab;
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onRemoved.addListener(onRemoved);
    void attach(tab);
  }, () => { if (!stopped) show('暂时无法读取当前标签页，请重新打开扩展。'); });

  return stop;
}
