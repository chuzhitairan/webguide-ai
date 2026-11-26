import { browser } from 'wxt/browser';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { createObservation } from '../src/page/snapshot.js';
import { clipsOverflow, pageParent, revealVertically } from '../src/page/locator.js';
import { watchPage } from '../src/page/observer.js';
import { createRenderer } from '../src/page/renderer.js';
import { guidePort } from '../src/guide/page-messages.js';
import type { PageCommand, PageRequest, PageSignal } from '../src/guide/page-messages.js';
import type { Evidence, Observation } from '../../api/src/guide-protocol.js';
import type { PageProof } from '../src/guide/session.js';

type Port = ReturnType<typeof browser.runtime.connect>;

const pointRoles = new Set(['button', 'link', 'row', 'gridcell', 'treeitem', 'option', 'tab', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'checkbox', 'radio', 'switch', 'textbox', 'combobox', 'searchbox']);
const resultRoles = new Set(['status', 'dialog', 'alertdialog']);
const arrivalRegions = new Set(['main', 'article', 'region', 'dialog', 'alertdialog', 'tabpanel', 'form']);
const headerRegions = new Set(['banner', 'group']);

export default defineUnlistedScript(() => {
  // 同一个文档可能被尝试连接多次，页面中只安装一个连接入口。
  const scope = globalThis as typeof globalThis & { webGuideInstalled?: boolean };
  if (scope.webGuideInstalled) return;
  scope.webGuideInstalled = true;
  let dispose: (() => void) | undefined;
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== guidePort || port.sender?.id !== browser.runtime.id) return;
    dispose?.();
    dispose = connect(port);
  });
});

function connect(port: Port): () => void {
  const renderer = createRenderer();
  let observation: ReturnType<typeof createObservation> | undefined;
  let generation = 0;
  let observed = -1;
  let sentIds = new Set<number>();
  let currentTarget: number | undefined;
  let actionTarget: number | undefined;
  let signature = '';
  let contextAtRead = '';
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let finishClick: AbortController | undefined;
  let stopped = false;
  let revealing = false;
  let scrolled = false;
  let scrollHint: { id: number; element: Element; key: string } | 'any' | undefined;
  const events = new AbortController();
  const notify = (event: PageSignal) => port.postMessage({ event });

  function clear() {
    clearTimeout(finishTimer);
    finishClick?.abort();
    finishClick = undefined;
    currentTarget = undefined;
    scrollHint = undefined;
    scrolled = false;
    renderer.clear();
  }

  function invalidate(event: 'action' | 'boundary') {
    // 一次操作可能连续触发 click、input、change。撤掉高亮时先记下这一轮要复查的控件。
    if (event === 'boundary' || currentTarget !== undefined) {
      actionTarget = event === 'action' ? currentTarget : undefined;
    }
    generation++;
    clear();
    notify(event);
  }

  function summarize(nodes: Evidence[]) {
    const target = currentTarget === undefined ? undefined : observation?.resolve(currentTarget)?.evidence;
    // 已有目标时，优先复核同区域和全局状态，略过附近无关的装饰或按钮。
    return JSON.stringify(nodes.filter(node => !target || node.id === target.id
      || (target.region !== undefined && node.region === target.region)
      || node.selected || ['alert', 'dialog', 'status'].includes(node.role)));
  }

  function contextKey(page: Observation) {
    const contexts = page.nodes.filter(node => node.selected || node.role === 'dialog' || node.role === 'alertdialog');
    return JSON.stringify([page.title, contexts.map(({ id, role, label }) => [id, role, label])]);
  }

  function sameContext(page: Observation) {
    if (contextKey(page) === contextAtRead) return true;
    // 右栏里的同名按钮可能还在，但左栏的选中对象已变。旧回复也要作废。
    observed = -1;
    clear();
    notify('lost');
    return false;
  }

  function check() {
    if (!observation || observed !== generation || stopped || revealing) return;
    const page = observation.page();
    if (!sameContext(page)) return;
    if (currentTarget !== undefined && !visibleTarget(currentTarget)) {
      clear();
      notify('lost');
      return;
    }
    if (scrolled && scrollHint && (scrollHint === 'any' || scrollKey(scrollHint.id) !== scrollHint.key)) {
      scrollHint = undefined;
      scrolled = false;
      notify('scroll');
      return;
    }
    const next = summarize(page.nodes);
    if (next !== signature) {
      signature = next;
      notify('changed');
    }
    scrolled = false;
  }

  function queueCheck() {
    if (checkTimer !== undefined) return;
    checkTimer = setTimeout(() => {
      checkTimer = undefined;
      check();
    }, 140);
  }

  const stopWatch = watchPage(document, queueCheck, event =>
    invalidate(event === 'user-action' ? 'action' : 'boundary'));
  document.addEventListener('scroll', event => {
    if (scrollHint === 'any' || event.target === scrollHint?.element) scrolled = true;
    queueCheck();
  }, { capture: true, signal: events.signal });

  function visibleTarget(id: number) {
    const target = observation?.resolve(id);
    if (!target?.evidence.viewport || !target.evidence.available) return;
    const { element, control } = target;
    const rect = element.getBoundingClientRect();
    // 先核对完整视口和实际命中点，再让 Driver 绘制。
    if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) return;
    for (let parent = pageParent(element); parent; parent = pageParent(parent)) {
      const style = getComputedStyle(parent);
      const box = parent.getBoundingClientRect();
      if (clipsOverflow(style, 'x')
        && (rect.left < box.left + parent.clientLeft || rect.right > box.left + parent.clientLeft + parent.clientWidth)) return;
      if (clipsOverflow(style, 'y')
        && (rect.top < box.top + parent.clientTop || rect.bottom > box.top + parent.clientTop + parent.clientHeight)) return;
    }
    const hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
    // 透明输入框可能正好覆盖关联的可见标签，两者都能接到这次操作。
    if (hit && (hit === control || element.contains(hit) || (element.getRootNode() instanceof ShadowRoot
      && (element.getRootNode() as ShadowRoot).host === hit))) return target;
  }

  function scrollKey(id: number) {
    return JSON.stringify(observation?.read({ type: 'region', id }).nodes
      .map(({ id, label, selected, checked }) => [id, label, selected, checked]));
  }

  function inside(element: Element, scope: Element) {
    for (let parent = pageParent(element); parent; parent = pageParent(parent)) {
      if (parent === scope) return true;
    }
    return false;
  }

  function provesScope(element: Element, label: string, scopeIds: number[] = [], requireViewport = true) {
    // 搜索也包含被面板裁掉的控件。第一个可见匹配可能是另一个对象的入口。
    const alternatives = observation?.namedControls(label, pointRoles)
      // 行及其同名的内部按钮可能只是同一处入口的两层语义。
      .filter(other => other.element !== element && !inside(element, other.element) && !inside(other.element, element)) ?? [];
    if (!alternatives.length) return true;
    // 页面脚本可能比首读多看到一个屏外候选。先给模型补看机会，再接受它的选择。
    if (!alternatives.some(other => sentIds.has(other.id))) return false;

    // 同名时，证明要核对一个确实包含目标、且排除其他候选的区域或对象。
    return scopeIds.some(id => {
      const scope = observation?.resolve(id);
      return !!scope?.evidence.label && (!requireViewport || scope.evidence.viewport) && inside(element, scope.element)
        && alternatives.every(other => !inside(other.element, scope.element));
    });
  }

  async function targetForDisplay(id: number, scopeIds: number[] = [], reveal = false) {
    const visible = visibleTarget(id);
    if (visible) return !pointRoles.has(visible.evidence.role) || provesScope(visible.element, visible.evidence.label, scopeIds)
      ? visible : undefined;
    if (!reveal || revealing) return;
    const source = observation;
    const before = source?.resolve(id);
    if (!source || !before?.evidence.available || !pointRoles.has(before.evidence.role)
      || !provesScope(before.element, before.evidence.label, scopeIds, false) || !revealVertically(before.element)) return;

    clear();
    revealing = true;
    const startedIn = generation;
    // 给滚动监听器一次更新列表的机会，再用原编号核对元素、所属区域和真实点击位置。
    await new Promise(resolve => setTimeout(resolve, 80));
    revealing = false;
    if (stopped || document.visibilityState === 'hidden' || observation !== source || generation !== startedIn
      || observed !== generation || !sameContext(source.page())) return;
    const target = visibleTarget(id);
    return target && provesScope(target.element, target.evidence.label, scopeIds) ? target : undefined;
  }

  function arrivalScope(identity: Evidence) {
    if (identity.role !== 'heading') return arrivalRegions.has(identity.role) ? observation?.resolve(identity.id) : undefined;
    const object = identity.object === undefined ? undefined : observation?.resolve(identity.object);
    for (let id = identity.region; id !== undefined;) {
      const region = observation?.resolve(id);
      if (!region) return;
      if (arrivalRegions.has(region.evidence.role)) {
        // 列表项里的标题不能借用它外面的主体控件作为已到达的证据。
        return object && !inside(region.element, object.element) ? undefined : region;
      }
      // 正文标题常包在页头。只穿过布局分组，到最近的实际内容区为止。
      if (!headerRegions.has(region.evidence.role)) return;
      id = region.evidence.region;
    }
  }

  function provesArrival(labels: Evidence[]) {
    return labels.some(identity => {
      if (identity.label === identity.role) return false;
      const region = arrivalScope(identity);
      if (!region) return false;
      return labels.some(content => {
        if (content.id === identity.id || content.label === identity.label || !content.available
          || (content.role !== 'text' && (!pointRoles.has(content.role) || content.role === 'link'))) return false;
        const target = observation?.resolve(content.id);
        return !!target && inside(target.element, region.element);
      });
    });
  }

  function pointScopes(proof: Extract<PageProof, { source: 'point' }>) {
    return proof.checks.filter(check => check.field === 'label' && check.id !== proof.targetId).map(check => check.id);
  }

  function verifies(proof: PageProof, reveal = false) {
    const mayBeOffscreen = reveal && proof.source === 'point';
    const matches = proof.checks.map(check => ({ check, evidence: observation?.resolve(check.id)?.evidence }));
    if (!matches.length || !matches.every(({ check, evidence }) =>
      evidence && (mayBeOffscreen || evidence.viewport) && evidence[check.field] === check.equals)) {
      return false;
    }
    if (proof.source === 'point') {
      const target = mayBeOffscreen ? observation?.resolve(proof.targetId) : visibleTarget(proof.targetId);
      return Boolean(target?.evidence.available && pointRoles.has(target.evidence.role)
        && matches.some(({ check }) => check.id === proof.targetId && check.field === 'label')
        && provesScope(target.element, target.evidence.label, pointScopes(proof), !mayBeOffscreen));
    }
    if (proof.source === 'arrival') {
      const labels = matches.flatMap(({ check, evidence }) => check.field === 'label' && evidence?.label ? [evidence] : []);
      return provesArrival(labels);
    }
    // 收起的选择控件可在名称里显示当前值。展开时应核对选项状态。
    return matches.some(({ check, evidence }) => {
      if (check.field === 'checked' || check.field === 'selected') return true;
      if (check.field !== 'label' || !evidence?.label) return false;
      const choiceSummary = evidence.expanded === false && (evidence.role === 'button' || evidence.role === 'combobox');
      return choiceSummary || resultRoles.has(evidence.role) || (evidence.role === 'textbox' && evidence.available);
    });
  }

  async function handle(command: PageCommand) {
    if (command.kind === 'clear') {
      clear();
      return true;
    }
    if (stopped || document.visibilityState === 'hidden') return null;
    if (command.kind === 'snapshot') {
      if (command.newRound || !observation) {
        // 等页面稳定后重新解析原目标。脱离文档或被复用的控件会自然失效。
        const focus = actionTarget === undefined ? undefined : observation?.resolve(actionTarget)?.element;
        actionTarget = undefined;
        observation = createObservation(document, focus);
      }
      observed = generation;
      const page = observation.page();
      sentIds = new Set(page.nodes.map(node => node.id));
      signature = summarize(page.nodes);
      contextAtRead = contextKey(page);
      return page;
    }
    // 用户操作之后、侧栏收到事件之前到达的回复也必须作废。
    if (!observation || observed !== generation) return null;
    if (!sameContext(observation.page())) return null;
    if (command.kind === 'read') {
      const results = command.queries.map(query => observation!.read(query));
      for (const result of results) for (const node of result.nodes) sentIds.add(node.id);
      return results;
    }
    if (command.kind === 'track-scroll') {
      const region = command.id === undefined ? undefined : observation.resolve(command.id);
      // 模型可能只给了文字提示。等一次实际滚动，即使首读仍是相同的控件，也重新补看。
      scrollHint = region && (region.evidence.canScrollUp || region.evidence.canScrollDown)
        ? { id: region.evidence.id, element: region.element, key: scrollKey(region.evidence.id) }
        : 'any';
      return true;
    }

    if (command.kind === 'verify') {
      if (!command.proofs.every(proof => verifies(proof, command.reveal))) return false;
      if (!command.finish) return true;
      const point = command.proofs.find(proof => proof.source === 'point');
      if (point) {
        const target = await targetForDisplay(point.targetId, pointScopes(point), command.reveal);
        if (!target || (command.reveal && !command.proofs.every(proof => verifies(proof)))) return false;
        currentTarget = point.targetId;
        renderer.show(target.element, { title: '已找到', instruction: command.finish });
        // 会话已完成，单独监听最后一次点击，让网站照常处理这次操作。
        finishClick = new AbortController();
        document.addEventListener('click', event => {
          const path = event.composedPath();
          if (event.isTrusted && (path.includes(target.element) || path.includes(target.control))) clear();
        }, { capture: true, signal: finishClick.signal });
        finishTimer = setTimeout(clear, 4_000);
      } else clear();
      stopped = true;
      stopWatch();
      events.abort();
      return true;
    }

    const decision = command.decision;
    const target = await targetForDisplay(decision.targetId, decision.scopeIds, decision.reveal);
    if (!target) return false;
    scrollHint = undefined;
    scrolled = false;
    currentTarget = decision.targetId;
    renderer.show(target.element, { title: '下一步', instruction: decision.instruction });
    signature = summarize(observation.page().nodes);
    return true;
  }

  port.onMessage.addListener(async ({ id, command }: PageRequest) => {
    const value = await handle(command).catch(() => null);
    try {
      port.postMessage({ id, value });
    } catch {
      // 等待滚动期间可能切换标签页或关闭了侧栏。
    }
  });
  function close() {
    stopped = true;
    stopWatch();
    events.abort();
    clearTimeout(checkTimer);
    clear();
  }
  port.onDisconnect.addListener(close);
  return () => {
    close();
    port.disconnect();
  };
}
