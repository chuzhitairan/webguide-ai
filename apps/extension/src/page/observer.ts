type PageEvent = 'page-left' | 'user-action';

const actionable = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"],'
  + ' [role="menuitem"], [role="tab"], [contenteditable="true"]';

// 引导开始时订阅页面变化，调用方在引导结束或离开页面后停止监听。
export function watchPage(
  document: Document,
  checkTarget: () => void,
  notify: (event: PageEvent) => void,
): () => void {
  const view = document.defaultView;
  if (!view) return () => {};
  const controller = new view.AbortController();
  const options = { signal: controller.signal, capture: true };
  const leavePage = () => notify('page-left');
  const userAction = (event: Event) => {
    const target = event.target;
    if (event.isTrusted && target instanceof view.Element && target.closest(actionable)) notify('user-action');
  };
  const observer = new view.MutationObserver(checkTarget);
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leavePage();
    else checkTarget();
  }, options);
  // 真实操作可以改变指引。原生 tooltip 也会触发 toggle，只用它检查页面状态。
  document.addEventListener('click', userAction, options);
  document.addEventListener('change', userAction, options);
  document.addEventListener('input', userAction, options);
  document.addEventListener('toggle', checkTarget, options);
  view.addEventListener('resize', checkTarget, options);
  view.addEventListener('pagehide', leavePage, options);
  view.addEventListener('popstate', leavePage, options);
  view.addEventListener('hashchange', leavePage, options);
  if ('navigation' in view) {
    // Chromium 的 Navigation API 同时覆盖站内 pushState 与 replaceState。
    (view.navigation as EventTarget).addEventListener('currententrychange', leavePage, options);
  }
  return () => {
    observer.disconnect();
    controller.abort();
  };
}
