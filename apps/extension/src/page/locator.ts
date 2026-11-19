import type { LocationResult, TargetSpec } from '@webguide/contracts';

// 只查当前主文档。浏览器的选择器负责解析 CSS；页面元素永远不经消息通道传出。
export function isVisibleTarget(element: Element, root: Document): boolean {
  if (!element.isConnected || element.getRootNode() !== root || !root.defaultView) return false;
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

export function resolveTarget(target: TargetSpec, root: Document): LocationResult {
  if (!('css' in target) || !target.css?.trim() || target.css.length > 512
    || (target.textEquals !== undefined && (typeof target.textEquals !== 'string' || target.textEquals.length > 256))) {
    return { status: 'unavailable' };
  }
  try {
    // 只比较明确指定的文字。多匹配时不能把第一个按钮当作用户的目标。
    const matches = Array.from(root.querySelectorAll(target.css))
      .filter(element => !element.closest('.driver-popover, .driver-overlay'))
      .filter(element => target.textEquals === undefined || element.textContent === target.textEquals);
    if (!matches.length) return { status: 'missing' };
    const visible = matches.filter(element => isVisibleTarget(element, root));
    if (!visible.length) return { status: 'unavailable' };
    if (visible.length > 1) return { status: 'ambiguous' };
    return { status: 'found', element: visible[0] };
  } catch {
    return { status: 'unavailable' };
  }
}
