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
