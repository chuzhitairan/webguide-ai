import { isAvailableTarget, isVisibleTarget } from './locator.js';
import type { Control, PageSnapshot } from '../navigation/protocol.js';

const maxControls = 140;
const controlSelector = 'a[href], button, summary, input[type="search"], input[aria-label]:is([type="text"],:not([type])),'
  + ' [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="searchbox"]';

function compact(value: string | null | undefined, limit: number): string {
  return value?.replace(/\s+/g, ' ').trim().slice(0, limit) ?? '';
}

function controlLabel(element: Element, document: Document): string {
  const name = element.getAttribute('aria-labelledby')?.trim().split(/\s+/)
    .map(id => document.getElementById(id)?.textContent).join(' ');
  return compact(name, 120) || compact(element.getAttribute('aria-label'), 120)
    || compact(element instanceof HTMLElement ? element.innerText ?? element.textContent : element.textContent, 120)
    || compact(element.getAttribute('title'), 120);
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

export function readPage(document: Document, url: URL, issuePath: string): { page: PageSnapshot; elements: Map<number, Element> } {
  const entries: { element: Element; control: Omit<Control, 'id'> }[] = [];
  const wantedPath = issuePath.toLowerCase();
  for (const element of document.querySelectorAll(controlSelector)) {
    const path = sameSitePath(element, url);
    const atLimit = entries.length >= maxControls;
    // 快照满了以后只检查与目标编号匹配的链接，避免继续读取整页样式。
    if (atLimit && (path?.toLowerCase() !== wantedPath || entries.some(item => item.control.path?.toLowerCase() === wantedPath))) continue;
    if (!isAvailableTarget(element, document)) continue;
    const label = controlLabel(element, document);
    if (!label) continue;

    // 给快照留出目标 Issue 的位置，避免长列表前面的其他控件耗完名额。
    if (atLimit) entries.pop();
    const role = element.getAttribute('role') || ({ A: 'link', INPUT: 'textbox' }[element.tagName] ?? 'button');
    const container = element.closest('nav, dialog, main, header, footer, [role="dialog"]');
    const region = compact(container?.getAttribute('aria-label'), 32) || container?.tagName.toLowerCase();
    entries.push({ element, control: { label, role: role.slice(0, 24), region, path } });
  }
  const heading = [...document.querySelectorAll('main h1, h1')].find(el => isVisibleTarget(el, document) && el.textContent?.trim());
  const title = compact(heading?.textContent ?? document.title, 160);
  const elements = new Map<number, Element>();
  const controls = entries.map(({ element, control }, index) => {
    const id = index + 1;
    elements.set(id, element);
    return { id, ...control };
  });
  return { page: { path: url.pathname, title, controls }, elements };
}
