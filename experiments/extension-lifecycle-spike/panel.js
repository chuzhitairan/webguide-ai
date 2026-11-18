const instanceId = crypto.randomUUID();
let port;
const connection = document.querySelector('#connection');
const status = document.querySelector('#status');
const report = document.querySelector('#report');
async function connect() {
  try {
    const win = await chrome.windows.getCurrent();
    port = chrome.runtime.connect({name: 'wg-lifecycle-panel'});
    port.onMessage.addListener((msg) => {
      if (msg.type === 'error') {
        status.textContent = `失败：${msg.message}。请刷新记录或重新打开侧栏。`;
        return;
      }
      if (msg.type !== 'snapshot') return;
      const task = msg.state.task;
      connection.textContent = '侧栏已连接；活动任务不靠定时心跳保持后台运行。';
      status.textContent = task ? `任务：${task.status}\n原因：${task.reason ?? '—'}\n已记录页面角色：${Object.keys(task.observations).join('、') || '无'}\n这些记录不是 Pages 发布成功结论。` : '尚未开始任务';
      report.value = JSON.stringify({experiment: 'extension-lifecycle-spike/0.0.1',
        browser: navigator.userAgent, panelInstanceId: instanceId,
        capabilities: msg.capabilities, ...msg.state}, null, 2);
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      connection.textContent = '与后台的连接已断开。活动指示应撤销；点击“刷新记录”重连，再明确选择继续。';
      port = null;
    });
    port.postMessage({type: 'hello', instanceId, windowId: win.id});
  } catch (error) { connection.textContent = `连接失败：${error.message}`; }
}
for (const button of document.querySelectorAll('button')) {
  button.addEventListener('click', async () => {
    if (!port) { await connect(); return; }
    try { port.postMessage({type: button.id}); }
    catch { connection.textContent = '连接不可用，请重新打开侧栏。'; }
  });
}
connect();
