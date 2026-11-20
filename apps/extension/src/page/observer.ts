type InvalidationReason = 'page-left' | 'target-changed';

// 引导开始时订阅页面变化，调用方在引导结束或离开页面后停止监听。
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
  // 控件状态变化也可能只发出事件，不修改 DOM 属性。
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
