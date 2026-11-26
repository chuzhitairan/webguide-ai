import type { Evidence, Observation, ReadQuery, ReadResult } from '../../../api/src/guide-protocol.js';
import { clipsOverflow, controlLabel, isEnabledTarget, isVisibleTarget, listEntryLabel, pageParent, verticalScrollRange } from './locator.js';

const pageLimit = 40;
const readLimit = 20;
const scanLimit = 6000;
const entryLinkLimit = 3;
const entryScanLimit = 120;

const regionRoles = new Set([
  'alertdialog', 'application', 'article', 'banner', 'complementary', 'contentinfo', 'dialog', 'form', 'grid', 'group',
  'listbox', 'main', 'menu', 'menubar', 'navigation', 'region', 'search', 'tablist', 'tabpanel', 'toolbar', 'tree', 'treegrid',
]);

const observedRoles = new Set([
  ...regionRoles, 'alert', 'button', 'checkbox', 'combobox', 'gridcell', 'heading', 'link', 'listitem', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'option', 'progressbar', 'radio', 'row', 'searchbox', 'slider',
  'spinbutton', 'status', 'switch', 'tab', 'textbox', 'treeitem',
]);
const entryRoles = new Set(['listitem', 'row']);
const objectRoles = new Set([...entryRoles, 'treeitem', 'option']);

const nativeRoles: Record<string, string> = {
  article: 'article', aside: 'complementary', button: 'button', dialog: 'dialog', footer: 'contentinfo', form: 'form', header: 'banner',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading', main: 'main',
  nav: 'navigation', option: 'option', output: 'status', progress: 'progressbar', summary: 'button', textarea: 'textbox',
};

const inputRoles: Record<string, string> = {
  button: 'button', checkbox: 'checkbox', image: 'button', number: 'spinbutton', radio: 'radio', range: 'slider',
  reset: 'button', search: 'searchbox', submit: 'button',
};

interface Candidate {
  element: Element;
  control: Element;
  isRegion: boolean;
  details: Omit<Evidence, 'id' | 'region'>;
}

interface Context {
  region?: number;
  object?: number;
}

interface Binding extends Context {
  id: number;
  element: Element;
  control: Element;
  role: string;
  label: string;
}

function compact(value: string, limit: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

function semanticRole(element: Element): string | undefined {
  const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit && observedRoles.has(explicit)) return explicit;
  switch (element.localName) {
    case 'a': return element.hasAttribute('href') ? 'link' : undefined;
    case 'li': return explicit === 'none' || explicit === 'presentation' ? undefined : 'listitem';
    case 'tr': return explicit === 'none' || explicit === 'presentation' ? undefined : 'row';
    case 'input': {
      const type = (element as HTMLInputElement).type;
      return type === 'hidden' ? undefined : inputRoles[type] ?? 'textbox';
    }
    case 'section': return controlLabel(element, { useContents: false }) ? 'region' : undefined;
    case 'select': return (element as HTMLSelectElement).multiple || (element as HTMLSelectElement).size > 1
      ? 'listbox' : 'combobox';
    case 'option': {
      const select = element.closest('select');
      return !select || select.multiple || select.size > 1 ? 'option' : undefined;
    }
    default: return nativeRoles[element.localName];
  }
}

// 几何上位于页面视口内，还可能被内层滚动容器裁掉。
function inViewport(element: Element, view: Window): boolean {
  const box = element.getBoundingClientRect();
  let left = Math.max(box.left, 0);
  let right = Math.min(box.right, view.innerWidth);
  let top = Math.max(box.top, 0);
  let bottom = Math.min(box.bottom, view.innerHeight);
  for (let node = pageParent(element); node && right > left && bottom > top; node = pageParent(node)) {
    const style = view.getComputedStyle(node);
    const clipsX = clipsOverflow(style, 'x');
    const clipsY = clipsOverflow(style, 'y');
    if (!clipsX && !clipsY) continue;
    const bounds = node.getBoundingClientRect();
    if (clipsX) {
      left = Math.max(left, bounds.left);
      right = Math.min(right, bounds.right);
    }
    if (clipsY) {
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
  }
  return right > left && bottom > top;
}

function ariaState(value: string | null): boolean | undefined {
  return value === 'true' ? true : value === 'false' ? false : undefined;
}

function standaloneText(element: Element): boolean {
  if (element.childElementCount || !element.matches('div, p, span')) return false;
  for (let node = pageParent(element); node; node = pageParent(node)) {
    if (node.localName === 'label' && (node as HTMLLabelElement).control) return false;
    const role = semanticRole(node);
    if (role && !regionRoles.has(role) && !entryRoles.has(role)) return false;
  }
  return true;
}

function describe(element: Element, document: Document, includeText = false): Candidate | undefined {
  // 一些网站只画出 label，真正的单选框或开关是透明的。用 label 的位置和输入控件的状态。
  const associated = element.localName === 'label' ? (element as HTMLLabelElement).control : null;
  const control = associated?.matches('input[type="radio"], input[type="checkbox"]')
    && !associated.closest('[aria-hidden="true"]') && !isVisibleTarget(associated, document) ? associated : element;
  const scrollRange = verticalScrollRange(element);
  const role = semanticRole(control) ?? (scrollRange ? 'region' : undefined)
    ?? (includeText && standaloneText(element) ? 'text' : undefined);
  if (!role || !document.defaultView || !isVisibleTarget(element, document, { asControlLabel: control !== element })) return;

  const isRegion = regionRoles.has(role) || scrollRange > 0;
  const regionHeading = isRegion ? element.querySelector(':scope > h1, :scope > h2, :scope > h3') : null;
  // 行内操作可能仅在悬停时出现。它们各有自己的编号，不参与对象名称。
  const entryLabel = role === 'listitem' || control.localName === 'tr' ? listEntryLabel(control) : '';
  const label = entryLabel || controlLabel(control, { useContents: !isRegion, excludeRowActions: objectRoles.has(role) })
    || (regionHeading && isVisibleTarget(regionHeading, document) ? controlLabel(regionHeading) : '')
    || (isRegion ? role : '');
  if (role === 'text' && !label) return;
  const expanded = ariaState(control.getAttribute('aria-expanded'))
    ?? (element.localName === 'summary' && element.parentElement?.localName === 'details'
      ? (element.parentElement as HTMLDetailsElement).open : undefined);
  const current = control.getAttribute('aria-current');
  const selected = ariaState(control.getAttribute('aria-selected'))
    ?? (current && current !== 'false' ? true : undefined)
    ?? (element.localName === 'option' ? (element as HTMLOptionElement).selected : undefined);
  const checked = ariaState(control.getAttribute('aria-checked'))
    ?? (control.localName === 'input' && (role === 'checkbox' || role === 'radio')
      ? (control as HTMLInputElement).checked : undefined);

  return {
    element, control, isRegion,
    details: {
      role, label, viewport: inViewport(element, document.defaultView),
      available: isEnabledTarget(element) && (control === element || isEnabledTarget(control)),
      ...(expanded === undefined ? {} : { expanded }),
      ...(selected === undefined ? {} : { selected }),
      ...(checked === undefined ? {} : { checked }),
      ...(scrollRange ? {
        canScrollUp: element.scrollTop > 1,
        canScrollDown: element.scrollTop < scrollRange - 1,
      } : {}),
    },
  };
}

function* descendants(root: Element | Document): Iterable<Element> {
  const slot = root.nodeType === 1 && (root as Element).localName === 'slot' ? root as HTMLSlotElement : undefined;
  const children = slot?.assignedNodes().length
    ? slot.assignedElements({ flatten: true }) : ((root as Element).shadowRoot ?? root).children;
  for (const child of children) {
    yield child;
    yield* descendants(child);
  }
}

function priority(candidate: Candidate): number {
  const { viewport, selected, role, label } = candidate.details;
  if (!viewport) return 3;
  if (candidate.isRegion || selected || role === 'alert' || role === 'status') return 0;
  return label && role !== 'text' ? 1 : 2;
}

function matchesSearch(keyword: string): (label: string) => boolean {
  if (!/^[#\p{L}\p{N}._-]+$/u.test(keyword) || !/\p{N}/u.test(keyword)) {
    return label => label.toLowerCase().includes(keyword);
  }
  // 有数字的完整标识按边界匹配，例如 #1 和订单 ORD-17。
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
  return label => pattern.test(label.toLowerCase());
}

// 实例归属一轮。首读与补看使用同一组编号，失效的编号不能指向后来复用的节点。
export function createObservation(document: Document, focus?: Element): {
  page(): Observation;
  read(query: ReadQuery): ReadResult;
  resolve(id: number): { element: Element; control: Element; evidence: Evidence } | undefined;
  namedControls(label: string, roles: ReadonlySet<string>): { element: Element; id: number }[];
} {
  const bindings = new Map<number, Binding>();
  const ids = new WeakMap<Element, number>();
  let nextId = 1;

  function forget(id: number, element: Element) {
    bindings.delete(id);
    if (ids.get(element) === id) ids.delete(element);
  }

  function contextFor(element: Element): Context {
    const ancestors: { candidate: Candidate; isObject: boolean }[] = [];
    for (let node = pageParent(element); node; node = pageParent(node)) {
      const role = semanticRole(node) ?? '';
      const isObject = objectRoles.has(role);
      if (!isObject && !regionRoles.has(role) && !verticalScrollRange(node)) continue;
      const candidate = describe(node, document);
      if (candidate) ancestors.push({ candidate, isObject });
    }
    // 从外到内复查，整行被复用或区域换了名字时，下面的旧控件一并失效。
    const context: Context = {};
    for (const { candidate, isObject } of ancestors.reverse()) {
      const { id } = remember(candidate, context);
      if (candidate.isRegion) context.region = id;
      if (isObject) context.object = id;
    }
    return context;
  }

  function evidence(candidate: Candidate, id: number, { region, object }: Context): Evidence {
    return { id, ...candidate.details, ...(region === undefined ? {} : { region }),
      ...(object === undefined ? {} : { object }) };
  }

  function remember(candidate: Candidate, { region, object } = contextFor(candidate.element)): Evidence {
    const { element, control, details: { role, label } } = candidate;
    const priorId = ids.get(element);
    const prior = priorId === undefined ? undefined : bindings.get(priorId);
    if (prior?.control === control && prior.role === role && prior.label === label && prior.region === region && prior.object === object) {
      return evidence(candidate, prior.id, { region, object });
    }
    if (prior) forget(prior.id, element);
    const id = nextId++;
    bindings.set(id, { id, element, control, role, label, region, object });
    ids.set(element, id);
    return evidence(candidate, id, { region, object });
  }

  function resolve(id: number) {
    const previous = bindings.get(id);
    if (!previous) return;
    const { element } = previous;
    const candidate = describe(element, document, previous.role === 'text');
    const { region, object } = candidate ? contextFor(element) : {};
    if (!candidate || previous.control !== candidate.control || previous.role !== candidate.details.role || previous.label !== candidate.details.label
      || previous.region !== region || previous.object !== object) {
      forget(id, element);
      return;
    }
    return { element, control: candidate.control, evidence: evidence(candidate, id, { region, object }) };
  }

  function owningEntry(element: Element): Element | undefined {
    for (let owner = pageParent(element); owner; owner = pageParent(owner)) {
      const role = semanticRole(owner) ?? '';
      if (objectRoles.has(role)) return entryRoles.has(role) ? owner : undefined;
    }
  }

  function* entryLinks(entry: Element): Iterable<Candidate> {
    let scanned = 0;
    let links = 0;
    for (const element of descendants(entry)) {
      if (scanned++ >= entryScanLimit || links >= entryLinkLimit) return;
      if (semanticRole(element) !== 'link') continue;
      // 只带回这个条目直接拥有的链接，跳过嵌套条目。相邻条目也不在扫描范围内。
      if (owningEntry(element) !== entry) continue;
      const link = describe(element, document);
      if (link) {
        links++;
        yield link;
      }
    }
  }

  function collect(root: Element | Document, limit: number, includeOffscreen: boolean, keyword = '') {
    const matches: Candidate[] = [];
    let scanned = 0;
    let truncated = false;
    let heading = '';
    const matchesKeyword = matchesSearch(keyword);
    for (const element of descendants(root)) {
      if (scanned++ >= scanLimit) {
        truncated = true;
        break;
      }
      // 列表条目用于定向搜索和关联，不额外占用普通页面地图的条数。
      const role = semanticRole(element);
      if (!keyword && (role === 'listitem' || (element.localName === 'tr' && !element.hasAttribute('role')))) continue;
      const candidate = describe(element, document, Boolean(keyword));
      if (!candidate) continue;
      const { label, viewport } = candidate.details;
      if (!heading && element.localName === 'h1') heading = label;
      if (!matchesKeyword(label)) continue;
      if (includeOffscreen || viewport) matches.push(candidate);
      else truncated = true;
    }
    matches.sort((first, second) => priority(first) - priority(second));
    const selected = new Map<Element, Candidate>();
    const expanded = new Set<Element>();
    for (const candidate of matches.slice(0, limit)) {
      selected.set(candidate.element, candidate);
      if (!keyword) continue;
      const role = candidate.details.role;
      const owner = role === 'text' ? owningEntry(candidate.element) : undefined;
      const entry = entryRoles.has(role) ? candidate : owner && describe(owner, document);
      if (!entry || expanded.has(entry.element)) continue;
      expanded.add(entry.element);
      selected.set(entry.element, entry);
      for (const link of entryLinks(entry.element)) selected.set(link.element, link);
    }
    const nodes = [...selected.values()].slice(0, limit).map(candidate => remember(candidate));
    return { heading, nodes, truncated: truncated || matches.length > limit || selected.size > limit };
  }

  const focusCandidate = focus && describe(focus, document);
  const focusId = focusCandidate && remember(focusCandidate).id;

  return {
    resolve,
    namedControls(label, roles) {
      if (!label) return [];
      const name = label.toLowerCase();
      const matches: { element: Element; id: number }[] = [];
      let scanned = 0;
      for (const element of descendants(document.body ?? document)) {
        if (scanned++ >= scanLimit) break;
        // 和观察器用同一套控件名称，保留滚动区域外已经渲染的可用控件。
        const candidate = describe(element, document);
        if (candidate?.details.available && roles.has(candidate.details.role)
          && candidate.details.label.toLowerCase() === name) matches.push({ element, id: remember(candidate).id });
      }
      return matches;
    },
    page() {
      const { heading, nodes, truncated } = collect(document.body ?? document, pageLimit, false);
      const focused = focusId === undefined ? undefined : resolve(focusId)?.evidence;
      // 把上一步高亮的控件放到首读前面。仍使用本轮编号，并保持原有观察上限。
      const ordered = focused?.viewport ? [focused, ...nodes.filter(node => node.id !== focused.id)] : nodes;
      return {
        title: compact(heading || document.title, 160), site: document.location.hostname,
        nodes: ordered.slice(0, pageLimit), truncated: truncated || ordered.length > pageLimit,
      };
    },
    read(query) {
      const unavailable: ReadResult = { query, nodes: [], truncated: false, status: 'unavailable' };
      if (query.type === 'inspect') {
        const target = resolve(query.id);
        if (!target) return unavailable;
        const nodes = [target.evidence];
        const owner = bindings.get(query.id)?.object;
        const object = owner === undefined ? undefined : resolve(owner);
        if (object) nodes.push(object.evidence);
        // 最近的区域也可能同名。向上补几层，让模型能区分不同对象的操作入口。
        for (let region = target.evidence.region; region !== undefined && nodes.length < 5;) {
          const scope = resolve(region);
          if (!scope) break;
          if (scope.evidence.id !== owner) nodes.push(scope.evidence);
          region = scope.evidence.region;
        }
        // 紧挨着的语义标题为同区的无名图标提供少量上下文。
        const previous = target.element.previousElementSibling;
        if (previous && semanticRole(previous) === 'heading') {
          const heading = describe(previous, document);
          if (heading) nodes.push(remember(heading));
        }
        return { query, nodes, truncated: false, status: 'ok' };
      }
      const regionId = query.type === 'region' ? query.id : query.region;
      const region = regionId === undefined ? undefined : resolve(regionId);
      if (regionId !== undefined && (!region
        || (!regionRoles.has(region.evidence.role) && !verticalScrollRange(region.element)))) return unavailable;

      const keyword = query.type === 'search' ? compact(query.query, 120).toLowerCase() : '';
      if (query.type === 'search' && !keyword) return { query, nodes: [], truncated: false, status: 'empty' };
      const { nodes, truncated } = collect(region?.element ?? document.body ?? document, readLimit,
        query.type === 'search' || query.includeOffscreen === true, keyword);
      return { query, nodes, truncated, status: nodes.length ? 'ok' : 'empty' };
    },
  };
}
