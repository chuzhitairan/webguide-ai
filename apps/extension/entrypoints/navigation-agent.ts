import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { browser } from 'wxt/browser';
import { inspectGoal, isGoalLink, isPreferredControl, isReadmeEditTarget, repositoryAt } from '../src/navigation/github-goal.js';
import type { BoundGoal, Control, PageCommand, PagePhase, PageUpdate } from '../src/navigation/protocol.js';
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

function evidenceKey(control: Control): string {
  return JSON.stringify([control.path ?? control.label, control.role, control.expanded]);
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
    type Target = { element: Element; identity: string; path?: string };
    let targets = new Map<number, Target>();
    let highlighted: (Target & { instruction: string }) | undefined;
    let seenEvidence = new Set<string>();
    let pendingReview: { signature: string; keys: string[] } | undefined;
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

    function indexTargets(controls: Control[], elements: Map<number, Element>) {
      const indexed = new Map<number, Target>();
      for (const control of controls) {
        const element = elements.get(control.id);
        if (element) indexed.set(control.id, { element, identity: targetIdentity(element), path: control.path });
      }
      targets = indexed;
    }

    function finishReview() {
      if (!pendingReview) return;
      for (const key of pendingReview.keys) seenEvidence.add(key);
      pendingReview = undefined;
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
          pendingReview = undefined;
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
      const { page, elements, preferredIds } = readPage(document, url, (element, path) =>
        element === current?.element || isPreferredControl(element, path, url, task));
      const evidence = page.controls.filter(control => preferredIds.has(control.id));
      if (sameTarget && samePhase && actions === guidedActions) {
        const target = evidence.find(control => elements.get(control.id) === current.element);
        if (!target) return;

        // 只复核新出现或状态改变的任务相关控件。控件编号会随快照变化，所以用控件含义去重。
        const changes = new Map<string, number>();
        for (const control of evidence) {
          const key = evidenceKey(control);
          if (control.id !== target.id && !seenEvidence.has(key)) changes.set(key, control.id);
        }
        if (!changes.size) {
          if (pendingReview) {
            pendingReview = undefined;
            ++revision;
          }
          return;
        }
        const keys = [...changes.keys()].sort();
        const signature = JSON.stringify(keys);
        if (pendingReview?.signature === signature) return;
        pendingReview = { signature, keys };
        indexTargets(page.controls, elements);
        observedActions = actions;
        publish({ kind: 'page', revision: ++revision, page, phase, review: {
          targetId: target.id, instruction: current.instruction, changedIds: [...changes.values()],
        } });
        return;
      }
      const next = url.href + JSON.stringify({ page, phase });
      if (next === fingerprint && (!current || sameTarget)) {
        if (!pendingReview) indexTargets(page.controls, elements);
        return;
      }
      if (!sameTarget || !samePhase) clearGuide();
      pendingReview = undefined;
      seenEvidence = new Set(evidence.map(evidenceKey));
      indexTargets(page.controls, elements);
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
            batchStarted = 0;
            pendingReview = undefined;
            ++revision;
            if (document.visibilityState !== 'hidden') publish({ kind: 'observing' });
          } else {
            ++actions;
          }
          scheduleScan();
        });
        scheduleScan();
      }
      if (message.kind !== 'decision' || !goal) return;
      if (revision !== message.revision || pageAddress !== document.location.href) return;
      // 模型等待期间网页可能已变。应用建议前再检查一次当前快照。
      scan();
      if (closed || document.visibilityState === 'hidden' || revision !== message.revision) return;
      const { decision } = message;
      const review = !!pendingReview;
      finishReview();
      if (decision.kind === 'keep') return;
      let readmeEntry = false;
      const instruction = decision.reason ? decision.reason + ' ' + decision.instruction : decision.instruction;
      if (decision.kind === 'highlight') {
        const target = targets.get(decision.targetId);
        if (!target || !isAvailableTarget(target.element, document) || targetIdentity(target.element) !== target.identity) return;
        const { element } = target;
        // 两个链接都能明确推进当前任务时，捷径出现也沿用已给出的指引。
        if (review && highlighted && (highlighted.element === element
          || (isGoalLink(highlighted.path, goal) && isGoalLink(target.path, goal)))) return;
        readmeEntry = goal.kind === 'readme-entry' && isReadmeEditTarget(element, new URL(document.location.href), goal.repo);
        if (highlighted?.element !== element || highlighted.instruction !== decision.instruction) {
          if (highlighted?.element !== element) clearGuide();
          highlighted = { ...target, instruction: decision.instruction };
          renderer.show(element, { title: '下一步', instruction: decision.instruction });
        }
      } else {
        clearGuide();
      }
      // 回包只结束它已经看到的操作。模型等待期间的点击仍可触发下一次判断。
      guidedActions = observedActions;
      publish({ kind: 'displayed', revision, instruction, readmeEntry });
    });
  });
});
