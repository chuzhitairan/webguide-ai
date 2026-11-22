import { browser } from 'wxt/browser';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { createObservation } from '../src/page/snapshot.js';
import { pageParent } from '../src/page/locator.js';
import { watchPage } from '../src/page/observer.js';
import { createRenderer } from '../src/page/renderer.js';
import { guidePort } from '../src/guide/page-messages.js';
import type { PageCommand, PageRequest, PageSignal } from '../src/guide/page-messages.js';
import type { Evidence, Observation } from '../../api/src/guide-protocol.js';

type Port = ReturnType<typeof browser.runtime.connect>;

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
  let currentTarget: number | undefined;
  let signature = '';
  let contextAtRead = '';
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let scrolled = false;
  let scrollHint: { id: number; element: Element; key: string } | undefined;
  const events = new AbortController();
  const notify = (event: PageSignal) => port.postMessage({ event });

  function clear() {
    clearTimeout(finishTimer);
    currentTarget = undefined;
    scrollHint = undefined;
    renderer.clear();
  }

  function invalidate(event: 'action' | 'boundary') {
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
    if (!observation || observed !== generation || stopped) return;
    const page = observation.page();
    if (!sameContext(page)) return;
    if (currentTarget !== undefined && !visibleTarget(currentTarget)) {
      clear();
      notify('lost');
      return;
    }
    if (scrolled && scrollHint) {
      const key = scrollKey(scrollHint.id);
      if (key !== scrollHint.key) {
        scrollHint = undefined;
        scrolled = false;
        notify('scroll');
        return;
      }
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
    if (event.target === scrollHint?.element) scrolled = true;
    queueCheck();
  }, { capture: true, signal: events.signal });

  function visibleTarget(id: number) {
    const target = observation?.resolve(id);
    if (!target?.evidence.viewport || !target.evidence.available) return;
    const { element } = target;
    const rect = element.getBoundingClientRect();
    // Driver 会把未完整显示的目标滚进视口。让用户先滚到能操作的位置。
    if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) return;
    for (let parent = pageParent(element); parent; parent = pageParent(parent)) {
      const style = getComputedStyle(parent);
      const box = parent.getBoundingClientRect();
      if (/(auto|scroll|overlay|hidden|clip)/.test(style.overflowX)
        && (rect.left < box.left + parent.clientLeft || rect.right > box.left + parent.clientLeft + parent.clientWidth)) return;
      if (/(auto|scroll|overlay|hidden|clip)/.test(style.overflowY)
        && (rect.top < box.top + parent.clientTop || rect.bottom > box.top + parent.clientTop + parent.clientHeight)) return;
    }
    const hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
    if (hit && (element.contains(hit) || (element.getRootNode() instanceof ShadowRoot
      && (element.getRootNode() as ShadowRoot).host === hit))) return target;
  }

  function scrollKey(id: number) {
    return JSON.stringify(observation?.read({ type: 'region', id }).nodes
      .map(({ id, label, selected, checked }) => [id, label, selected, checked]));
  }

  function handle(command: PageCommand) {
    if (command.kind === 'clear') {
      clear();
      return true;
    }
    if (stopped || document.visibilityState === 'hidden') return null;
    if (command.kind === 'snapshot') {
      if (command.newRound || !observation) observation = createObservation(document);
      observed = generation;
      const page = observation.page();
      signature = summarize(page.nodes);
      contextAtRead = contextKey(page);
      return page;
    }
    // 用户操作之后、侧栏收到事件之前到达的回复也必须作废。
    if (!observation || observed !== generation) return null;
    if (!sameContext(observation.page())) return null;
    if (command.kind === 'read') return command.queries.map(query => observation!.read(query));
    if (command.kind === 'track-scroll') {
      const region = observation.resolve(command.id);
      if (!region?.evidence.canScrollUp && !region?.evidence.canScrollDown) return false;
      scrollHint = { id: command.id, element: region.element, key: scrollKey(command.id) };
      return true;
    }

    const decision = command.decision;
    const target = decision.targetId === undefined ? undefined : visibleTarget(decision.targetId);
    if (decision.targetId !== undefined && !target) return false;
    if (decision.kind === 'complete') {
      const proof = decision.checks.map(check => ({ check, evidence: observation?.resolve(check.id)?.evidence }));
      if (!proof.every(({ check, evidence }) => evidence && evidence[check.field] === check.equals)) return false;
      // 看到按钮可以证明找到了入口。要报告操作已生效，还需看到结果状态。
      const supportsCompletion = target
        ? proof.some(({ check }) => check.id === decision.targetId && check.field === 'label')
        : proof.some(({ check, evidence }) => evidence?.viewport && (
          ['checked', 'selected', 'expanded'].includes(check.field)
          || (check.field === 'label' && ['heading', 'status', 'alert', 'dialog'].includes(evidence.role))));
      if (!supportsCompletion) return false;
    }

    if (target) {
      currentTarget = decision.targetId;
      renderer.show(target.element, { title: decision.kind === 'complete' ? '已找到' : '下一步', instruction: decision.instruction });
      signature = summarize(observation.page().nodes);
    } else clear();
    if (decision.kind === 'complete') {
      stopped = true;
      stopWatch();
      events.abort();
      if (target) finishTimer = setTimeout(clear, 4_000);
    }
    return true;
  }

  port.onMessage.addListener(({ id, command }: PageRequest) => {
    const value = handle(command);
    port.postMessage({ id, value });
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
