export const KEY = 'wgLifecycleV1';
export const TASK_TAG = 'WG-LIFECYCLE-V1';
export function pageRole(raw) {
  try {
    const u = new URL(raw);
    if (u.search || u.hash) return null;
    const roles = {
      'http://127.0.0.1:43117/webguide-lifecycle/settings.html': 'settings',
      'http://127.0.0.1:43117/webguide-lifecycle/workflow.html': 'workflow',
      'http://127.0.0.1:43118/webguide-lifecycle/site.html': 'site',
    };
    return roles[u.href] ?? null;
  } catch { return null; }
}
export function recover(saved, bootId) {
  const state = saved?.schema === 1
    ? structuredClone(saved)
    : {schema: 1, task: null, logs: []};
  if (state.task?.status === 'active') {
    state.task.status = 'paused';
    state.task.reason = 'background-restarted';
    state.task.revision++;
    state.task.owner = null;
  }
  state.bootId = bootId;
  return state;
}
export function appendLog(state, event, detail = {}) {
  state.logs.push({at: new Date().toISOString(), bootId: state.bootId, event, ...detail});
  state.logs = state.logs.slice(-100);
}
export function matchesObservation(task, expected, msg, documentId) {
  return Boolean(task?.status === 'active' && expected &&
    expected.taskId === task.id && expected.revision === task.revision &&
    msg.taskId === task.id && msg.revision === task.revision &&
    msg.requestId === expected.requestId && documentId === expected.documentId &&
    pageRole(msg.url) === expected.role && msg.url === expected.url);
}
export function ownsTask(task, instanceId, windowId) {
  return Boolean(task && task.owner === instanceId && task.windowId === windowId);
}
