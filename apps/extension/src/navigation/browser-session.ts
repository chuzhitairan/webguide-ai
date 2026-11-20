import { browser } from 'wxt/browser';
import { bindGoal, goalPrompt, repositoryAt } from './github-goal.js';
import type { BoundGoal, Goal, ModelRequest, ModelResponse, PageCommand, PagePhase, PageUpdate } from './protocol.js';

type Tab = { id?: number; windowId: number; url?: string; pendingUrl?: string; status?: string; active: boolean };
type Port = ReturnType<typeof browser.tabs.connect>;
export type NavigationStatus = { text: string; done?: boolean };

export function startNavigation(requestedGoal: Goal, token: string, report: (status: NavigationStatus) => void): () => void {
  let stopped = false;
  let initialTab: Tab | undefined;
  let goal: BoundGoal | undefined;
  let port: Port | undefined;
  let attachment = 0;
  let requestNumber = 0;
  let pageRevision: number | undefined;
  let phase: PagePhase | undefined;
  let forkShown = false;
  let styledDocument: string | undefined;

  function show(text: string) {
    report({ text });
  }

  function outsideRepository() {
    show(forkShown
      ? '如果你已进入自己的 Fork，可以在副本里的 README 页面重新开始引导。'
      : '请回到本次引导的 GitHub 仓库，必要时点击扩展图标重新授权。');
  }

  function disconnect() {
    ++attachment;
    ++requestNumber;
    pageRevision = undefined;
    phase = undefined;
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
    if (!tab.url || repositoryAt(tab.url)?.toLowerCase() !== goal.repo.toLowerCase()) {
      outsideRepository();
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
          disconnect();
          show('页面连接已断开。请重新开始引导。');
        }
      });
      const command: PageCommand = { kind: 'observe', goal };
      connection.postMessage(command);
    } catch {
      if (attachment === currentAttachment) show('无法读取当前网页。请在 GitHub 页面点击工具栏的 WebGuide AI 后重试。');
    }
  }

  async function receive(connection: Port, update: PageUpdate) {
    if (port !== connection || !goal) return;
    if (update.kind === 'displayed') {
      if (pageRevision !== update.revision) return;
      const prefix = update.readmeEntry ? '已找到 README 编辑入口。'
        : phase === 'fork-required' ? 'GitHub 要求先 Fork。' : '';
      show(prefix + update.instruction);
      return;
    }
    const currentRequest = ++requestNumber;
    if (update.kind === 'observing') {
      pageRevision = undefined;
      phase = undefined;
      show('正在查看新页面…');
      return;
    }
    if (update.kind === 'outside') {
      pageRevision = undefined;
      outsideRepository();
      return;
    }
    pageRevision = update.revision;
    phase = update.phase;
    if (phase === 'arrived') {
      const text = goal.kind === 'issue' ? '已打开 Issue #' + goal.number : '已进入 README 编辑器。';
      stop();
      report({ text, done: true });
      return;
    }
    if (phase === 'login-required') {
      stop();
      report({ text: '请先登录 GitHub。登录后回到 README 文件页，可重新开始引导。', done: true });
      return;
    }
    // 地址可能先于网页内容变化。等详情渲染后再确认任务是否到达。
    if (phase === 'waiting-issue' && goal.kind === 'issue') {
      show('正在确认 Issue #' + goal.number + '。如果 GitHub 显示不可访问，请核对编号或权限。');
      return;
    }
    if (phase === 'waiting-editor') {
      show('正在确认 README 编辑页面。请留意 GitHub 的登录或权限提示。');
      return;
    }
    if (phase === 'fork-required') {
      forkShown = true;
      if (goal.kind === 'readme-entry') {
        stop();
        report({ text: '已找到 README 编辑入口。GitHub 要求先 Fork 才能继续。', done: true });
        return;
      }
    }
    const pageNotice = phase === 'fork-required' ? 'GitHub 要求先 Fork。' : '';
    if (update.page.path.length > 300 || update.page.path.startsWith('//')) {
      show('当前页面地址过长或格式不受支持。请回到仓库页面后重试。');
      return;
    }
    if (!update.page.controls.length) {
      show(pageNotice + '正在等待页面显示可操作控件…');
      return;
    }
    if (!update.review) show(pageNotice + 'AI 正在查看当前页面…');
    const request: ModelRequest = {
      kind: 'choose-navigation', token,
      goal: goalPrompt(goal, phase),
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
    // 页面可操作时就可以引导，无需等待图片等资源。完整跳转时换到新文档。
    if (change.status === 'loading' || !port) void attach(tab);
  }

  function onActivated(event: { tabId: number; windowId: number }) {
    if (!initialTab || event.windowId !== initialTab.windowId) return;
    if (event.tabId === initialTab.id) {
      void browser.tabs.get(event.tabId).then(attach, () => stop());
    } else {
      disconnect();
      show('引导已暂停。回到原来的标签页即可继续。');
    }
  }

  function onRemoved(id: number) {
    if (id !== initialTab?.id) return;
    stop();
    show('引导标签页已关闭。');
  }

  void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (stopped) return;
    goal = bindGoal(tab?.url, requestedGoal);
    if (!goal || tab?.id === undefined) {
      show('请先打开 GitHub 仓库，并在该标签页点击工具栏的 WebGuide AI。');
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
