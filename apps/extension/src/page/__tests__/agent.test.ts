// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CheckRequest, FixtureCollaborationTarget, ObservationPayloadResult, PageBinding, ShowGuide, Stop } from '@webguide/contracts';
import { startPageAgent, type PageAgentOptions, type PageCommand, type PageReport, type PageTransport } from '../agent.js';

const target: FixtureCollaborationTarget = {
  profile: 'fixture_collaboration_v1', origins: [location.origin], targetRevision: 1,
  repo: 'team/demo', issueNumber: 1, member: 'ada', baseBranch: 'main', headBranch: 'practice',
  documentPath: 'README.md', expectedEdit: { before: 'a', after: 'b', practiceMarker: 'b' },
  branchStart: null, commitAnchor: null, prBinding: null,
};
const binding: PageBinding = {
  id: 'binding', tabId: 3, windowId: 2, frameId: 0, documentId: 'document', url: location.href,
  origin: location.origin, pageRole: 'issue', objectKey: 'team/demo#1', navigationRevision: 1,
};
const check: CheckRequest = {
  type: 'CHECK_REQUEST', requestId: 'first', checkSequence: 1, coordinatorEpoch: 'epoch', taskId: 'task',
  contextRevision: 1, targetRevision: 1, tutorialIdentity: { id: 'demo', version: '1', contentHash: 'hash' },
  bindingId: binding.id, documentId: binding.documentId, navigationRevision: 1, checkerId: 'issue',
  pageRole: binding.pageRole, objectKey: binding.objectKey, stepId: 'assign', target, targetSpec: { css: '#assign' },
  check: { type: 'adapter', checkerId: 'issue' },
};
const show: ShowGuide = {
  ...check, type: 'SHOW_GUIDE', target: check.targetSpec, copy: { title: 'Claim issue', instruction: 'Click assign' }, leaseMs: 6_000,
};
const stop: Stop = {
  type: 'STOP', taskId: 'task', coordinatorEpoch: 'epoch', bindingId: binding.id, documentId: binding.documentId,
  contextRevision: 2, stopEpoch: 1, reason: 'paused',
};
const ok: ObservationPayloadResult = { status: 'ok', kind: 'issue', objectKey: binding.objectKey, payload: { assigned: false } };
const cleanups: (() => void)[] = [];

function setup(
  collect: (request: CheckRequest, doc: Document) => ObservationPayloadResult | Promise<ObservationPayloadResult> = () => ok,
  onReport?: (report: PageReport) => void,
  resolveLocator?: PageAgentOptions['resolveLocator'],
) {
  const reports: PageReport[] = [];
  let receive: (message: PageCommand) => void = () => {};
  let disconnect: () => void = () => {};
  const transport: PageTransport = {
    onMessage(listener) { receive = listener; return () => {}; },
    onDisconnect(listener) { disconnect = listener; return () => {}; },
    send(event) { reports.push(event); onReport?.(event); },
  };
  const dispose = startPageAgent({
    document, transport, collect, resolveLocator,
    identify: () => ({ pageRole: binding.pageRole, objectKey: binding.objectKey }),
  });
  cleanups.push(dispose);
  const bind = () => receive({ type: 'PAGE_BOUND', coordinatorEpoch: 'epoch', binding });
  return { receive, disconnect, reports, bind };
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<button id="assign">Assign</button>';
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(5, 5, 80, 20));
});
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
const highlighted = () => document.querySelector('.webguide-popover') !== null;

it('collects only an authorized request matching the current local role, object, URL and document', async () => {
  const collect = vi.fn(() => ok);
  const page = setup(collect);
  page.receive(check);
  expect(collect).not.toHaveBeenCalled();
  page.bind();
  for (const invalid of [
    { documentId: 'other' }, { coordinatorEpoch: 'old' }, { objectKey: 'another-issue' },
    { pageRole: 'editor' }, { bindingId: 'other' }, { navigationRevision: 0 }, { targetRevision: 10 },
    { target: { ...target, origins: ['https://elsewhere.invalid'] } },
  ]) page.receive({ ...check, ...invalid });
  expect(collect).not.toHaveBeenCalled();
  page.receive(check);
  await Promise.resolve();
  expect(page.reports).toContainEqual(expect.objectContaining({
    type: 'CHECK_RESULT', observation: expect.objectContaining({
      location: { status: 'found', target: check.targetSpec, bindingId: binding.id },
    }),
  }));
  page.receive(show);
  expect(highlighted()).toBe(true);
});

it('clears the guide before reporting a replaced element, and ignores stale renewals', async () => {
  const page = setup(undefined, report => {
    if (report.type === 'LOCATION_INVALIDATED') expect(highlighted()).toBe(false);
  });
  page.bind();
  page.receive(check);
  await Promise.resolve();
  page.receive(show);
  expect(highlighted()).toBe(true);
  const old = document.querySelector('#assign')!;
  const replacement = document.createElement('button');
  replacement.id = 'assign';
  old.replaceWith(replacement);
  // MutationObserver 在浏览器下一次绘制前交付这次变化，无需等待后台回复。
  await Promise.resolve();
  expect(page.reports.at(-1)?.type).toBe('LOCATION_INVALIDATED');
  page.receive(show);
  expect(highlighted()).toBe(false);
});

it('rechecks after a branch form opens even when the highlighted summary stays in place', async () => {
  document.body.innerHTML = '<details><summary id="assign">打开分支菜单</summary><input></details>';
  const page = setup();
  page.bind();
  page.receive(check);
  await Promise.resolve();
  page.receive(show);
  expect(highlighted()).toBe(true);
  document.querySelector('details')!.dispatchEvent(new Event('toggle'));
  expect(highlighted()).toBe(false);
  expect(page.reports.at(-1)?.type).toBe('LOCATION_INVALIDATED');
});

it('rechecks after typing settles while the focused editor remains the target', async () => {
  document.body.innerHTML = '<textarea id="assign"></textarea>';
  const edit = document.querySelector('textarea')!;
  const page = setup();
  page.bind();
  page.receive(check);
  await Promise.resolve();
  page.receive(show);
  edit.focus();
  edit.value = 'saved draft';
  edit.dispatchEvent(new Event('input', { bubbles: true }));
  expect(highlighted()).toBe(true);
  vi.advanceTimersByTime(200);
  expect(highlighted()).toBe(false);
  expect(document.activeElement).toBe(edit);
});

it('rechecks the registered locator before renewing a concrete commit target', async () => {
  document.body.innerHTML = '<input id="mode" value="current"><button id="confirm">Commit</button><button id="fix">Correct branch</button>';
  const mode = document.querySelector<HTMLInputElement>('#mode')!;
  const request = { ...check, targetSpec: { locatorId: 'commit' } };
  const guide = { ...show, target: { css: '#confirm' } };
  const page = setup(
    () => ({ ...ok, location: { status: 'found', target: { css: '#confirm' } } }),
    undefined,
    () => ({ status: 'found', element: document.querySelector(mode.value === 'current' ? '#confirm' : '#fix')! }),
  );
  page.bind();
  page.receive(request);
  await Promise.resolve();
  page.receive(guide);
  expect(highlighted()).toBe(true);
  // 网站脚本可以改变提交去向而不发出 change，也不触发 MutationObserver。
  mode.value = 'new-branch';
  page.receive(guide);
  expect(highlighted()).toBe(false);
  expect(page.reports.at(-1)?.type).toBe('LOCATION_INVALIDATED');
});

it('renews only the current authorized guide at two seconds and cannot raise an expired guide', async () => {
  const page = setup();
  page.bind();
  page.receive(check);
  await Promise.resolve();
  page.receive(show);
  vi.advanceTimersByTime(2_000);
  page.receive(show);
  vi.advanceTimersByTime(3_000);
  page.receive({ ...show, requestId: 'stale' });
  vi.advanceTimersByTime(2_999);
  expect(highlighted()).toBe(true);
  vi.advanceTimersByTime(1);
  expect(highlighted()).toBe(false);
  page.receive(show);
  expect(highlighted()).toBe(false);
});

it('clears synchronously on STOP and ignores an old STOP after resuming', async () => {
  const page = setup();
  page.bind();
  page.receive(check);
  await Promise.resolve();
  page.receive(show);
  page.receive(stop);
  expect(highlighted()).toBe(false);
  expect(page.reports.at(-1)).toMatchObject({ type: 'STOP_ACK', stopEpoch: 1, documentId: binding.documentId, status: 'stopped' });
  page.receive(check);
  page.receive(show);
  expect(highlighted()).toBe(false);
  const resumed = { contextRevision: 3, requestId: 'next', checkSequence: 2 };
  page.receive({ ...check, ...resumed });
  await Promise.resolve();
  page.receive({ ...show, ...resumed });
  page.receive(stop);
  expect(highlighted()).toBe(true);
});

it.each(['hidden', 'navigation', 'disconnect'] as const)('stops immediately on %s and ignores a late result', async reason => {
  let finish!: (result: ObservationPayloadResult) => void;
  const collect = vi.fn().mockReturnValueOnce(ok).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const page = setup(collect);
  page.bind();
  page.receive(check);
  await Promise.resolve();
  page.receive(show);
  const interrupt = () => {
    if (reason === 'disconnect') page.disconnect();
    if (reason === 'navigation') window.dispatchEvent(new Event('pagehide'));
    if (reason === 'hidden') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    }
  };
  interrupt();
  expect(highlighted()).toBe(false);
  // 再建一个页面代理，检查采集中断后才返回的数据也会丢弃。
  vi.restoreAllMocks();
  cleanups.pop()?.();
  const another = setup(collect);
  another.bind();
  another.receive(check);
  if (reason === 'disconnect') another.disconnect();
  else window.dispatchEvent(new Event('pagehide'));
  finish(ok);
  await Promise.resolve();
  expect(another.reports.some(event => event.type === 'CHECK_RESULT')).toBe(false);
});
