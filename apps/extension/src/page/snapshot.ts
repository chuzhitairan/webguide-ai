import { controlLabel, isAvailableTarget, isVisibleTarget } from './locator.js';
interface Control {
  id: number;
  label: string;
  role: string;
  region?: string;
  path?: string;
  expanded?: boolean;
}

interface PageSnapshot {
  path: string;
  title: string;
  controls: Control[];
}

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

// 编号只在这次观察中有效。文本摘要和原网页元素分开保存。
export function readPage(document: Document, url: URL): { page: PageSnapshot; elements: Map<number, Element> } {
  const controls: Control[] = [];
  const elements = new Map<number, Element>();
  for (const element of document.querySelectorAll(controlSelector)) {
    if (controls.length >= maxControls) break;
    if (!isAvailableTarget(element, document)) continue;
    const label = controlLabel(element);
    if (!label) continue;

    const role = element.getAttribute('role') || ({ A: 'link', INPUT: 'textbox' }[element.tagName] ?? 'button');
    const container = element.closest('nav, dialog, main, header, footer, [role="dialog"]');
    const region = compact(container?.getAttribute('aria-label'), 32) || container?.tagName.toLowerCase();
    const expansion = element.getAttribute('aria-expanded');
    const expanded = expansion === 'true' ? true : expansion === 'false' ? false : undefined;
    const id = controls.length + 1;
    elements.set(id, element);
    controls.push({ id, label, role: role.slice(0, 24), region, path: sameSitePath(element, url), expanded });
  }
  const heading = [...document.querySelectorAll('main h1, h1')].find(el => isVisibleTarget(el, document) && el.textContent?.trim());
  const title = compact(heading?.textContent ?? document.title, 160);
  return { page: { path: url.pathname, title, controls }, elements };
}
