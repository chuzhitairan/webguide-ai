// 只检查当前主文档里的元素。节点移除或祖先被隐藏后，高亮目标就失效了。
export function isVisibleTarget(element: Element, root: Document): boolean {
  if (!element.isConnected || element.getRootNode() !== root || !root.defaultView) return false;
  if (element.closest('[aria-hidden="true"]')) return false;
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return false;
  const visibility = root.defaultView.getComputedStyle(element).visibility;
  if (visibility === 'hidden' || visibility === 'collapse') return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = root.defaultView.getComputedStyle(node);
    if (node.hasAttribute('hidden') || style.display === 'none' || style.opacity === '0'
      || style.contentVisibility === 'hidden') return false;
  }
  return true;
}

export function isAvailableTarget(element: Element, root: Document): boolean {
  // :disabled 由浏览器判定，包含 fieldset 的规则和 legend 的例外。
  return !element.matches(':disabled')
    && !element.closest('[aria-disabled="true"], [inert], .webguide-popover, .driver-overlay')
    && isVisibleTarget(element, root);
}

export function controlLabel(element: Element): string {
  const compact = (value?: string | null) => value?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '';
  // GitHub 的部分图标按钮通过独立提示元素提供可访问名称。
  const referenced = element.getAttribute('aria-labelledby')?.trim().split(/\s+/)
    .map(id => element.ownerDocument.getElementById(id)?.textContent).join(' ');
  return compact(referenced) || compact(element.getAttribute('aria-label'))
    || compact(element instanceof HTMLElement ? element.innerText ?? element.textContent : element.textContent)
    || compact(element.getAttribute('title'));
}
