export function pageParent(element: Element): Element | null {
  const root = element.getRootNode();
  return element.assignedSlot ?? element.parentElement ?? (root.nodeType === 11 ? (root as ShadowRoot).host ?? null : null);
}

export function overflowOnAxis(style: CSSStyleDeclaration, axis: 'x' | 'y'): string {
  const [x, y = x] = style.overflow.split(/\s+/);
  return axis === 'x' ? style.overflowX || x : style.overflowY || y;
}

export function clipsOverflow(style: CSSStyleDeclaration, axis: 'x' | 'y'): boolean {
  // 普通行内元素没有用于裁剪子元素的内容区。inline-block 则仍要检查。
  return !['inline', 'contents'].includes(style.display)
    && /^(auto|scroll|overlay|hidden|clip)$/.test(overflowOnAxis(style, axis));
}

// 节点移除或所在区域被隐藏后，原目标失效。开放 Shadow DOM 也要检查宿主。
export function isVisibleTarget(element: Element, root: Document, { asControlLabel = false } = {}): boolean {
  const view = root.defaultView;
  if (!element.isConnected || element.ownerDocument !== root || !view) return false;
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return false;
  const visibility = view.getComputedStyle(element).visibility;
  if (visibility === 'hidden' || visibility === 'collapse') return false;
  for (let node: Element | null = element; node; node = pageParent(node)) {
    const style = view.getComputedStyle(node);
    // 控件已经提供语义时，网站可以只把重复的图形标签从读屏树隐藏。
    const hiddenFromAccessibility = node.getAttribute('aria-hidden') === 'true' && !(asControlLabel && node === element);
    if (hiddenFromAccessibility || node.matches('[hidden], .webguide-popover, .driver-overlay')
      || style.display === 'none' || style.opacity === '0'
      || style.contentVisibility === 'hidden') return false;
  }
  return true;
}

export function isEnabledTarget(element: Element): boolean {
  // :disabled 由浏览器判定，包含 fieldset 的规则和 legend 的例外。
  if (element.matches(':disabled')) return false;
  for (let node: Element | null = element; node; node = pageParent(node)) {
    if (node.matches('[aria-disabled="true"], [inert]')) return false;
  }
  return true;
}

export function isAvailableTarget(element: Element, root: Document): boolean {
  return isVisibleTarget(element, root) && isEnabledTarget(element);
}

const privateContent = 'input, textarea, [contenteditable]:not([contenteditable="false"]), script, style, template';
const toggle = 'input[type="checkbox"], [role="checkbox"], [role="switch"]';
// 表格可能把开关和它的标签放在同一格，标签文字也属于行内操作。
const rowActions = `button, [role="button"], [role="tooltip"], ${toggle}, :is(td, th, [role="cell"], [role="gridcell"]):has(${toggle})`;
const nestedItems = 'li, tr, [role="listitem"], [role="row"]';

function compact(value?: string | null): string {
  return value?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '';
}

function publicText(element: Element, excludeRowActions = false, excludeNestedItems = false): string {
  const view = element.ownerDocument.defaultView;
  if (element.matches('select') || element.closest(privateContent) || !view) return '';
  const parts: string[] = [];
  let length = 0;
  let visited = 0;
  let previous: Node | null = null;
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === 1) {
        const child = node as Element;
        if (child.matches(`${privateContent}, select, [hidden], [aria-hidden="true"]`)
          || (excludeRowActions && child.matches(rowActions))
          || (excludeNestedItems && child.matches(nestedItems))) return NodeFilter.FILTER_REJECT;
        const style = view.getComputedStyle(child);
        if (style.display === 'none' || style.opacity === '0' || style.contentVisibility === 'hidden') return NodeFilter.FILTER_REJECT;
      }
      const parent = node.nodeType === 3 && node.parentElement;
      if (parent && parent !== element && /^(hidden|collapse)$/.test(view.getComputedStyle(parent).visibility)) return NodeFilter.FILTER_SKIP;
      return node.nodeType === 3 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  for (let node = walker.nextNode(); node && length < 240 && visited < 120; node = walker.nextNode()) {
    // 连续文本可以被模板注释隔开。保留原来的分隔，避免把「#」和「1」拼成「# 1」。
    let sibling = node.previousSibling;
    while (sibling?.nodeType === Node.COMMENT_NODE) sibling = sibling.previousSibling;
    const text = node.textContent?.slice(0, 240) ?? '';
    if (sibling !== previous) parts.push(' ');
    parts.push(text);
    previous = node;
    length += text.length;
    visited += 1;
  }
  return compact(parts.join(''));
}

export function listEntryLabel(element: Element): string {
  return publicText(element, true, true);
}

export function controlLabel(element: Element, { useContents = true, excludeRowActions = false } = {}): string {
  // 开放 Shadow DOM 内的标签引用在原树内解析；表单的当前值不会进入名称。
  const root = element.getRootNode() as Document | ShadowRoot;
  const referenced = element.getAttribute('aria-labelledby')?.trim().split(/\s+/).slice(0, 8)
    .map(id => root.getElementById?.(id)).map(label => label ? publicText(label) : '').join(' ');
  const labels = (element as HTMLInputElement).labels;
  const associated = labels ? [...labels].slice(0, 8).map(label => publicText(label)).join(' ') : '';
  return compact(referenced) || compact(element.getAttribute('aria-label'))
    || compact(associated) || (useContents && excludeRowActions ? publicText(element, true) : '')
    || (useContents ? publicText(element) : '')
    || compact(element.getAttribute('title'));
}
