import {KEY, TASK_TAG, pageRole, recover, appendLog, matchesObservation, ownsTask} from './state.mjs';

const bootId = crypto.randomUUID();
const panels = new Map();
const pages = new Map();
const expected = new Map();
const capabilities = {
  sidePanel: Boolean(chrome.sidePanel),
  onOpened: Boolean(chrome.sidePanel?.onOpened),
  onClosed: Boolean(chrome.sidePanel?.onClosed),
  storageSession: Boolean(chrome.storage.session),
};
let state;
let queue = Promise.resolve();
const ready = (async () => {
  if (!capabilities.storageSession) throw new Error('storage.session 不可用');
  const saved = (await chrome.storage.session.get(KEY))[KEY];
  state = recover(saved, bootId);
  appendLog(state, 'background-boot', {recoveredTask: Boolean(saved?.task), capabilities});
  await chrome.storage.session.set({[KEY]: state});
  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true});
  }
})();

function post(port, msg) {
  try { port.postMessage(msg); } catch { /* Disconnected endpoints are handled separately. */ }
}
function clearPages(reason) {
  expected.clear();
  for (const p of pages.values()) post(p.port, {type: 'clear', reason});
}
async function publish() {
  await chrome.storage.session.set({[KEY]: state});
  for (const p of panels.values()) post(p.port, {type: 'snapshot', state, capabilities});
}
function enqueue(work, replyPort) {
  queue = queue.then(async () => {
    await ready;
    await work();
    await publish();
  }).catch((error) => {
    clearPages('coordinator-error');
    if (state?.task) {
      state.task.status = 'paused';
      state.task.reason = 'coordinator-error';
      state.task.revision++;
    }
    for (const p of panels.values()) post(p.port, {type: 'error', message: error.message});
    if (replyPort) post(replyPort, {type: 'error', message: error.message});
  });
}
function pause(reason) {
  clearPages(reason);
  if (!state.task) return;
  state.task.status = 'paused';
  state.task.reason = reason;
  state.task.owner = null;
  state.task.revision++;
  appendLog(state, 'task-paused', {reason, taskId: state.task.id});
}
async function checkActive(panel) {
  const task = state.task;
  if (task?.status !== 'active' || !ownsTask(task, panel.instanceId, panel.windowId)) {
    throw new Error('请在所属窗口点击开始／继续，再核对页面');
  }
  clearPages('new-check');
  task.revision++;
  const [tab] = await chrome.tabs.query({active: true, windowId: task.windowId});
  const page = pages.get(tab?.id);
  if (!page || !pageRole(tab?.url) || page.url !== tab.url) {
    task.reason = 'outside-fixture-or-page-not-ready';
    appendLog(state, 'check-unavailable', {tabId: tab?.id});
    return;
  }
  const request = {
    type: 'check', taskId: task.id, revision: task.revision,
    requestId: crypto.randomUUID(), documentId: page.documentId,
    role: pageRole(page.url), url: page.url,
  };
  expected.set(tab.id, request);
  task.reason = 'checking';
  // Commit the revision before authorizing a page read.
  await chrome.storage.session.set({[KEY]: state});
  post(page.port, request);
  appendLog(state, 'check-issued', {tabId: tab.id, role: request.role, revision: task.revision});
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'wg-lifecycle-panel') {
    let panel;
    port.onMessage.addListener((msg) => enqueue(async () => {
      if (msg.type === 'hello' && typeof msg.instanceId === 'string' && Number.isInteger(msg.windowId)) {
        if (panel) return;
        panel = {port, instanceId: msg.instanceId, windowId: msg.windowId};
        panels.set(panel.instanceId, panel);
        // Rebuilding a UI never silently resumes collection.
        if (state.task?.status === 'active' && state.task.windowId === panel.windowId) {
          pause('panel-instance-replaced');
        }
        appendLog(state, 'panel-connected', {instanceId: panel.instanceId, windowId: panel.windowId});
        return;
      }
      if (!panel || panels.get(panel.instanceId) !== panel) return;
      if (msg.type === 'start') {
        if (state.task && state.task.windowId !== panel.windowId) {
          throw new Error('已有任务属于另一个窗口；先在原窗口清空实验记录');
        }
        const [tab] = await chrome.tabs.query({active: true, windowId: panel.windowId});
        if (!pageRole(tab?.url)) throw new Error('请先打开本机实验页');
        clearPages('new-task');
        state.task = {id: crypto.randomUUID(), tag: TASK_TAG, revision: 0,
          windowId: panel.windowId, owner: panel.instanceId, status: 'active', observations: {}};
        appendLog(state, 'task-started', {taskId: state.task.id, windowId: panel.windowId});
        await checkActive(panel);
      } else if (msg.type === 'resume') {
        if (!state.task || state.task.windowId !== panel.windowId) throw new Error('本窗口没有可继续的任务');
        state.task.status = 'active';
        state.task.owner = panel.instanceId;
        await checkActive(panel);
      } else if (msg.type === 'check') {
        await checkActive(panel);
      } else if (msg.type === 'pause') {
        if (state.task?.windowId === panel.windowId) pause('user-paused');
      } else if (msg.type === 'reset') {
        if (state.task && state.task.windowId !== panel.windowId) throw new Error('请在任务所属窗口清空');
        clearPages('reset');
        state.task = null;
        state.logs = [];
        appendLog(state, 'reset');
      } else if (msg.type === 'snapshot') {
        appendLog(state, 'snapshot-requested');
      }
    }, port));
    port.onDisconnect.addListener(() => enqueue(async () => {
      if (!panel || panels.get(panel.instanceId) !== panel) return;
      panels.delete(panel.instanceId);
      appendLog(state, 'panel-disconnected', {instanceId: panel.instanceId, windowId: panel.windowId});
      if (ownsTask(state.task, panel.instanceId, panel.windowId) && state.task.status === 'active') {
        pause('panel-connection-lost');
      }
    }));
    return;
  }
  if (port.name !== 'wg-lifecycle-page' || port.sender?.frameId !== 0 ||
      !Number.isInteger(port.sender?.tab?.id) || !pageRole(port.sender.url)) return port.disconnect();
  const tabId = port.sender.tab.id;
  const page = {port, tabId, windowId: port.sender.tab.windowId,
    documentId: port.sender.documentId, url: port.sender.url};
  port.onMessage.addListener((msg) => enqueue(async () => {
    if (msg.type === 'hello') {
      pages.set(tabId, page);
      post(port, {type: 'clear', reason: 'page-connected-awaiting-check'});
      appendLog(state, 'page-connected', {tabId, role: pageRole(page.url), documentId: page.documentId});
    } else if (pages.get(tabId) === page && msg.type === 'observation') {
      const request = expected.get(tabId);
      if (!matchesObservation(state.task, request, msg, page.documentId)) {
        post(port, {type: 'clear', reason: 'stale-observation'});
        appendLog(state, 'observation-rejected', {tabId});
        return;
      }
      state.task.observations[request.role] = {at: new Date().toISOString(), tabId,
        documentId: page.documentId, taskId: state.task.id, url: msg.url,
        target: msg.target === 'unique-visible' ? 'unique-visible' : 'missing-or-ambiguous'};
      state.task.reason = 'observation-recorded';
      appendLog(state, 'observation-accepted', {tabId, role: request.role, target: msg.target});
    } else if (pages.get(tabId) === page && msg.type === 'invalidated') {
      if (matchesObservation(state.task, expected.get(tabId), msg, page.documentId)) expected.delete(tabId);
      appendLog(state, 'page-highlight-cleared', {tabId, reason: msg.reason});
    }
  }, port));
  port.onDisconnect.addListener(() => enqueue(async () => {
    if (pages.get(tabId) !== page) return;
    pages.delete(tabId);
    expected.delete(tabId);
    appendLog(state, 'page-disconnected', {tabId});
  }));
});

chrome.tabs.onActivated.addListener((info) => enqueue(async () => {
  if (state.task?.status === 'active' && state.task.windowId === info.windowId) {
    clearPages('active-tab-changed');
    state.task.revision++;
    state.task.reason = 'tab-changed-recheck-required';
    appendLog(state, 'tab-activated', {tabId: info.tabId, windowId: info.windowId});
  }
}));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url && change.status !== 'loading') return;
  enqueue(async () => {
    const page = pages.get(tabId);
    if (!page) return;
    post(page.port, {type: 'clear', reason: 'tab-navigation'});
    expected.delete(tabId);
    appendLog(state, 'tab-navigation', {tabId, allowed: Boolean(pageRole(change.url))});
  });
});
for (const [name, event] of [['native-panel-opened', chrome.sidePanel?.onOpened],
                            ['native-panel-closed', chrome.sidePanel?.onClosed]]) {
  event?.addListener((info) => enqueue(async () => {
    // Native events don't carry our UI instance ID: record them, don't guess an owner.
    appendLog(state, name, {windowId: info.windowId, tabId: info.tabId, path: info.path});
  }));
}
