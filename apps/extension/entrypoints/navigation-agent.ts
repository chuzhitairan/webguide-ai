import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { browser } from 'wxt/browser';
import { inspectGoal, isPreferredControl, isReadmeEditTarget, repositoryAt } from '../src/navigation/github-goal.js';
import type { BoundGoal, PageCommand, PagePhase, PageUpdate } from '../src/navigation/protocol.js';
import { controlLabel, isAvailableTarget } from '../src/page/locator.js';
import { readPage } from '../src/page/navigation-snapshot.js';
import { watchPage } from '../src/page/observer.js';
import { createRenderer } from '../src/page/renderer.js';

const installed = Symbol.for('webguide.realtime-navigation');

function targetIdentity(element: Element): string {
  const href = element.getAttribute('href');
  // 链接文案可能带动态计数，目的地址仍相同就沿用当前指引。
  return href ? 'link:' + href : 'control:' + controlLabel(element);
}

export default defineUnlistedScript(() => {
  const world = globalThis as typeof globalThis & { [installed]?: boolean };
  if (world[installed]) return;
  world[installed] = true;
  let closeActive: (() => void) | undefined;

  browser.runtime.onConnect.addListener(port => {
    if (port.name !== 'webguide-navigation' || port.sender?.id !== browser.runtime.id) return;
    closeActive?.();
    const renderer = createRenderer();
    let goal: BoundGoal | undefined;
    let revision = 0;
    let fingerprint = '';
    let pageAddress = '';
    let pagePhase: PagePhase | undefined;
    let targets = new Map<number, Element>();
    let highlighted: { element: Element; identity: string; instruction: string } | undefined;
    let actions = 0;
    let observedActions = 0;
    let guidedActions = 0;
    let timer: number | undefined;
    let batchStarted = 0;
    let stopWatching: (() => void) | undefined;
    let closed = false;

    function clearGuide() {
      if (highlighted) renderer.clear();
      highlighted = undefined;
    }

    function publish(update: PageUpdate) {
      try { port.postMessage(update); } catch { close(); }
    }

    function scan() {
      if (!goal || document.visibilityState === 'hidden') return;
      const url = new URL(document.location.href);
      const repo = repositoryAt(url.href);
      if (repo?.toLowerCase() !== goal.repo.toLowerCase()) {
        clearGuide();
        if (fingerprint !== 'outside') {
          fingerprint = 'outside';
          ++revision;
          publish({ kind: 'outside' });
        }
        return;
      }
      const task = goal;
      const phase = inspectGoal(document, url, task);
      const current = highlighted;
      const sameTarget = current && pageAddress === url.href && isAvailableTarget(current.element, document)
        && targetIdentity(current.element) === current.identity;
      const samePhase = phase === pagePhase;
      // 第一条有效指引显示后，背景加载或悬停可以继续改变网页，但不会换目标或改提示。
      if (sameTarget && samePhase && actions === guidedActions) return;

      const { page, elements } = readPage(document, url, (element, path) => isPreferredControl(element, path, url, task));
      const next = url.href + JSON.stringify({ page, phase });
      targets = elements;
      if (next === fingerprint && (!current || sameTarget)) return;
      if (!sameTarget || !samePhase) clearGuide();
      pageAddress = url.href;
      pagePhase = phase;
      fingerprint = next;
      observedActions = actions;
      publish({ kind: 'page', revision: ++revision, page, phase });
    }

    function scheduleScan() {
      const now = Date.now();
      batchStarted ||= now;
      window.clearTimeout(timer);
      // 同一次网页更新常有多个 DOM 事件。合并观察，最多等 650 毫秒。
      const delay = Math.max(0, Math.min(180, batchStarted + 650 - now));
      timer = window.setTimeout(() => {
        timer = undefined;
        batchStarted = 0;
        scan();
      }, delay);
    }

    function close() {
      if (closed) return;
      closed = true;
      window.clearTimeout(timer);
      stopWatching?.();
      clearGuide();
      if (closeActive === close) closeActive = undefined;
      port.disconnect();
    }

    closeActive = close;
    port.onDisconnect.addListener(close);
    port.onMessage.addListener((message: PageCommand) => {
      if (message.kind === 'observe' && !goal) {
        goal = message.goal;
        stopWatching = watchPage(document, scheduleScan, event => {
          if (event === 'page-left') {
            clearGuide();
            fingerprint = '';
          } else {
            ++actions;
          }
          scheduleScan();
        });
        scan();
      }
      if (message.kind !== 'decision' || !goal) return;
      // 模型等待期间网页可能已变。应用建议前再检查一次当前快照。
      scan();
      if (closed || document.visibilityState === 'hidden' || revision !== message.revision) return;
      const { decision } = message;
      let readmeEntry = false;
      if (decision.kind === 'highlight') {
        const element = targets.get(decision.targetId);
        if (!element || !isAvailableTarget(element, document)) return;
        readmeEntry = goal.kind === 'readme-entry' && isReadmeEditTarget(element, new URL(document.location.href), goal.repo);
        if (highlighted?.element !== element || highlighted.instruction !== decision.instruction) {
          if (highlighted?.element !== element) clearGuide();
          highlighted = { element, identity: targetIdentity(element), instruction: decision.instruction };
          renderer.show(element, { title: '下一步', instruction: decision.instruction });
        }
      } else {
        clearGuide();
      }
      // 回包只结束它已经看到的操作。模型等待期间的点击仍可触发下一次判断。
      guidedActions = observedActions;
      publish({ kind: 'displayed', revision, instruction: decision.instruction, readmeEntry });
    });
  });
});
