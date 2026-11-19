import type { RuntimeEvent } from '@webguide/contracts';

type InvalidationReason = Extract<RuntimeEvent, { type: 'LOCATION_INVALIDATED' }>['reason'];

// 只在当前请求的有限租期内订阅页面变化。撤销监听与高亮在同一事件回调中完成。
export function watchPage(
  document: Document,
  checkTarget: () => void,
  invalidate: (reason: InvalidationReason) => void,
): () => void {
  const view = document.defaultView;
  if (!view) return () => {};
  const controller = new view.AbortController();
  const options = { signal: controller.signal, capture: true };
  let typingTimer: number | undefined;
  const leavePage = () => invalidate('page-left');
  const changeTarget = () => invalidate('target-changed');
  const observer = new view.MutationObserver(checkTarget);
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leavePage();
  }, options);
  // 表单提交去向等属性可以只存在于控件的 JS 状态中，不一定触发 DOM mutation。
  document.addEventListener('change', changeTarget, options);
  document.addEventListener('toggle', changeTarget, options);
  document.addEventListener('input', () => {
    // 等输入稍停再核对，避免每个按键都撤下提示、重读一次表单。
    view.clearTimeout(typingTimer);
    typingTimer = view.setTimeout(changeTarget, 150);
  }, options);
  view.addEventListener('resize', checkTarget, options);
  view.addEventListener('pagehide', leavePage, options);
  view.addEventListener('popstate', leavePage, options);
  view.addEventListener('hashchange', leavePage, options);
  if ('navigation' in view) {
    // Chromium 的 Navigation API 同时覆盖站内 pushState 与 replaceState。
    (view.navigation as EventTarget).addEventListener('currententrychange', leavePage, options);
  }
  return () => {
    view.clearTimeout(typingTimer);
    observer.disconnect();
    controller.abort();
  };
}
