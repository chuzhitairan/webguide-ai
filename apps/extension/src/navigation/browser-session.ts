import { browser } from 'wxt/browser';
import { issueGoal, repositoryAt } from './issue-goal.js';
import type { ModelRequest, ModelResponse, PageCommand, PageUpdate } from './protocol.js';

type Tab = { id?: number; windowId: number; url?: string; pendingUrl?: string; status?: string; active: boolean };
type Port = ReturnType<typeof browser.tabs.connect>;
export type NavigationStatus = { text: string; done?: boolean };

export function startIssueNavigation(number: string, token: string, report: (status: NavigationStatus) => void): () => void {
  let stopped = false;
  let initialTab: Tab | undefined;
  let goal: ReturnType<typeof issueGoal>;
  let port: Port | undefined;
  let attachment = 0;
  let requestNumber = 0;
  let pageRevision: number | undefined;
  let styledDocument: string | undefined;

  function show(text: string) {
    report({ text });
  }

  function disconnect() {
    ++attachment;
    ++requestNumber;
    pageRevision = undefined;
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
      show('请回到本次引导的 GitHub 仓库，必要时点击扩展图标重新授权。');
      return;
    }
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
      const command: PageCommand = { kind: 'observe', issuePath: goal.path };
      connection.postMessage(command);
    } catch {
      if (attachment === currentAttachment) show('无法读取当前网页。请在 GitHub 页面点击工具栏的 WebGuide AI 后重试。');
    }
  }

  async function receive(connection: Port, update: PageUpdate) {
    if (port !== connection || !goal) return;
    if (update.kind === 'displayed') {
      if (pageRevision === update.revision) show(update.instruction);
      return;
    }
    const currentRequest = ++requestNumber;
    if (update.kind === 'outside') {
      pageRevision = undefined;
      show('请回到本次引导的 GitHub 仓库。');
      return;
    }
    pageRevision = update.revision;
    if (update.reached) {
      const reached = goal.number;
      stop();
      report({ text: '已打开 Issue #' + reached, done: true });
      return;
    }
    // 地址先于 GitHub 的详情内容变化。此时只等页面证据，避免把旧列表再发给模型。
    if (update.page.path.replace(/\/$/, '').toLowerCase() === goal.path.toLowerCase()) {
      show('正在确认 Issue #' + goal.number + '。如果 GitHub 显示不可访问，请核对编号或权限。');
      return;
    }
    if (update.page.path.length > 300 || update.page.path.startsWith('//')) {
      show('当前页面地址过长或格式不受支持。请回到仓库页面后重试。');
      return;
    }
    if (!update.page.controls.length) {
      show('正在等待页面显示可操作控件…');
      return;
    }
    show('AI 正在查看当前页面…');
    const request: ModelRequest = {
      kind: 'choose-navigation', token,
      goal: '在 GitHub 仓库 ' + goal.repo + ' 打开 Issue #' + goal.number + '。优先使用该仓库的 Issues 入口和列表。',
      page: update.page,
    };
    try {
      const response = await browser.runtime.sendMessage(request) as ModelResponse;
      // 两次观察即使在同一个标签页，回包顺序也可能颠倒。
      if (port !== connection || requestNumber !== currentRequest) return;
      if ('error' in response) {
        show(response.error);
        return;
      }
      const command: PageCommand = { kind: 'decision', revision: update.revision, decision: response.decision };
      connection.postMessage(command);
    } catch {
      if (port === connection && requestNumber === currentRequest) show('暂时无法获取导航建议，请重新开始引导。');
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
    goal = issueGoal(tab?.url, number);
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
