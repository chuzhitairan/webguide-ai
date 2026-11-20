import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { browser } from 'wxt/browser';
import { repositoryAt, reachedIssue } from '../src/navigation/issue-goal.js';
import type { Control, PageCommand, PageUpdate } from '../src/navigation/protocol.js';
import { isAvailableTarget } from '../src/page/locator.js';
import { readPage } from '../src/page/navigation-snapshot.js';
import { watchPage } from '../src/page/observer.js';
import { createRenderer } from '../src/page/renderer.js';

const installed = Symbol.for('webguide.realtime-navigation');

function controlIdentity(control: Control): string {
  return JSON.stringify([control.label, control.role, control.path]);
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
    let issuePath = '';
    let revision = 0;
    let fingerprint = '';
    let pageAddress = '';
    let targets = new Map<number, Element>();
    let controls: Control[] = [];
    let highlighted: { element: Element; identity: string; instruction: string } | undefined;
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
      const url = new URL(document.location.href);
      const repo = repositoryAt(url.href);
      if (!repo || !issuePath.toLowerCase().startsWith(repo.toLowerCase() + '/issues/')) {
        clearGuide();
        if (fingerprint !== 'outside') {
          fingerprint = 'outside';
          ++revision;
          publish({ kind: 'outside' });
        }
        return;
      }
      const { page, elements } = readPage(document, url, issuePath);
      const reached = reachedIssue(document, url, issuePath);
      const next = url.href + JSON.stringify({ page, reached });
      targets = elements;
      controls = page.controls;
      const current = highlighted;
      const sameTarget = current && pageAddress === url.href && page.controls.some(control =>
        targets.get(control.id) === current.element && controlIdentity(control) === current.identity);
      if (next === fingerprint && (!current || sameTarget)) return;
      // 邻近菜单等控件变化时，暂时保留仍有效的高亮，避免提示框闪烁。
      if (!sameTarget || reached) clearGuide();
      pageAddress = url.href;
      fingerprint = next;
      publish({ kind: 'page', revision: ++revision, page, reached });
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
      if (message.kind === 'observe' && !issuePath) {
        issuePath = message.issuePath;
        stopWatching = watchPage(document, scheduleScan, reason => {
          if (reason === 'page-left') clearGuide();
          scheduleScan();
        });
        scan();
      }
      if (message.kind !== 'decision' || !issuePath) return;
      // 模型等待期间网页可能已变。应用建议前再检查一次当前快照。
      scan();
      if (closed || revision !== message.revision) return;
      const { decision } = message;
      if (decision.kind === 'highlight') {
        const element = targets.get(decision.targetId);
        const control = controls[decision.targetId - 1];
        if (!element || !control || !isAvailableTarget(element, document)) return;
        if (highlighted?.element !== element || highlighted.instruction !== decision.instruction) {
          clearGuide();
          highlighted = { element, identity: controlIdentity(control), instruction: decision.instruction };
          renderer.show(element, { title: '下一步', instruction: decision.instruction });
        }
      } else {
        clearGuide();
      }
      publish({ kind: 'displayed', revision, instruction: decision.instruction });
    });
  });
});
