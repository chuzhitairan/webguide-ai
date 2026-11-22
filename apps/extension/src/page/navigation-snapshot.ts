import { controlLabel, isAvailableTarget, isVisibleTarget } from './locator.js';
import type { Control, PageSnapshot } from '../navigation/protocol.js';

const maxControls = 140;
const controlSelector = 'a[href], button, summary, input[type="search"], input[aria-label]:is([type="text"],:not([type])),'
  + ' [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="searchbox"]';

function compact(value: string | null | undefined, limit: number): string {
  return value?.replace(/\s+/g, ' ').trim().slice(0, limit) ?? '';
}

function sameSitePath(element: Element, url: URL): string | undefined {
  const href = element.getAttribute('href');
  if (!href) return;
  try {
    const destination = new URL(href, element.ownerDocument.baseURI);
    if (destination.origin === url.origin && !destination.pathname.startsWith('//') && destination.pathname.length <= 300) {
      return destination.pathname;
    }
  } catch {
    return;
  }
}

export function readPage(document: Document, url: URL, prefer?: (element: Element, path?: string) => boolean,
  candidates: Iterable<Element> = document.querySelectorAll(controlSelector)):
  { page: PageSnapshot; elements: Map<number, Element>; preferredIds: Set<number> } {
  const entries: { element: Element; control: Omit<Control, 'id'>; preferred: boolean }[] = [];
  for (const element of candidates) {
    const path = sameSitePath(element, url);
    const atLimit = entries.length >= maxControls;
    const preferred = prefer?.(element, path) ?? false;
    // 快照满了以后，只让任务相关的控件替换普通候选。
    if (atLimit && (!preferred || (path && entries.some(item => item.preferred && item.control.path === path)))) continue;
    if (!isAvailableTarget(element, document)) continue;
    const label = controlLabel(element);
    if (!label) continue;

    if (atLimit) {
      let replace = entries.length - 1;
      while (replace >= 0 && entries[replace].preferred) --replace;
      if (replace < 0) continue;
      entries.splice(replace, 1);
    }
    const role = element.getAttribute('role') || ({ A: 'link', INPUT: 'textbox', H2: 'heading' }[element.tagName] ?? 'button');
    const container = element.closest('nav, dialog, main, header, footer, [role="dialog"]');
    const region = compact(container?.getAttribute('aria-label'), 32) || container?.tagName.toLowerCase();
    // 标题只用于指示位置。高亮库临时加上的 aria-expanded 不代表网页区域展开了。
    const expansion = role === 'heading' ? null : element.getAttribute('aria-expanded');
    const expanded = expansion === 'true' ? true : expansion === 'false' ? false : undefined;
    entries.push({ element, preferred, control: { label, role: role.slice(0, 24), region, path, expanded } });
  }
  const heading = [...document.querySelectorAll('main h1, h1')].find(el => isVisibleTarget(el, document) && el.textContent?.trim());
  const title = compact(heading?.textContent ?? document.title, 160);
  const elements = new Map<number, Element>();
  const preferredIds = new Set<number>();
  const controls = entries.map(({ element, control, preferred }, index) => {
    const id = index + 1;
    elements.set(id, element);
    if (preferred) preferredIds.add(id);
    return { id, ...control };
  });
  return { page: { path: url.pathname, title, controls }, elements, preferredIds };
}
