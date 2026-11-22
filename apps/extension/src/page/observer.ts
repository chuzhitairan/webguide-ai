type PageEvent = 'page-left' | 'user-action';

const actionable = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"],'
  + ' [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"],'
  + ' [role="row"], [role="treeitem"], [role="option"], [role="switch"], [contenteditable="true"]';

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
    if (event.isTrusted && event.composedPath().some(node => node instanceof view.Element && node.matches(actionable))) {
      notify('user-action');
    }
  };
  const registered = new WeakSet<Document | ShadowRoot>();
  const watchOptions = { subtree: true, childList: true, attributes: true, characterData: true };
  const observer = new view.MutationObserver(changes => {
    for (const change of changes) {
      for (const child of change.addedNodes) if (child instanceof view.Element) findShadowRoots(child);
    }
    checkTarget();
  });

  function observe(root: Document | ShadowRoot) {
    if (registered.has(root)) return;
    registered.add(root);
    observer.observe(root, watchOptions);
    findShadowRoots(root);
  }

  function findShadowRoots(root: Document | ShadowRoot | Element) {
    if (root instanceof view!.Element && root.shadowRoot) observe(root.shadowRoot);
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) observe(element.shadowRoot);
  }
  observe(document);

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
