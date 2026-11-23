import { expect, it, vi } from 'vitest';
import { createGuideSession } from '../session.js';
import type { GuidePage, GuideStatus } from '../session.js';
import type { Decision, Evidence, GuideRequest, ReadQuery } from '../../../../api/src/guide-protocol.js';

const button: Evidence = { id: 2, label: 'Publish settings', role: 'button', viewport: true, available: true };
const heading: Evidence = { id: 5, label: 'Settings published', role: 'status', viewport: true, available: true };
const search: ReadQuery = { type: 'search', query: 'Publish' };
const inspect: ReadQuery = { type: 'inspect', id: 1 };

it('合并局部补看，等用户操作后再完成自然语言目标', async () => {
  let evidence: Evidence[] = [];
  const calls: GuideRequest[] = [];
  const apply = vi.fn<GuidePage['apply']>().mockResolvedValue(true);
  const page: GuidePage = {
    async snapshot() { return { title: 'Project', site: 'example.test', nodes: evidence, truncated: false }; },
    async read(queries) {
      return queries.map(query => ({ query, nodes: [button], status: 'ok', truncated: false }));
    },
    apply,
    trackScroll() {},
    clear() {},
  };
  const statuses: GuideStatus[] = [];
  const session = createGuideSession('请找到发布设置并确认发布成功', {
    report(status) { statuses.push(status); },
    async choose(input) {
      calls.push(input);
      if (input.page.nodes.some(node => node.id === 5)) {
        return { kind: 'complete', instruction: '已发布', checks: [{ id: 5, field: 'label', equals: 'Settings published' }] };
      }
      return input.reads.length > 0
        ? { kind: 'highlight', instruction: '点击发布设置', targetId: 2 }
        : { kind: 'observe', queries: [search, inspect] };
    },
  });
  await session.attach(page);
  expect(calls).toHaveLength(2);
  expect(calls[1].reads).toHaveLength(2);
  expect(apply).toHaveBeenCalledExactlyOnceWith({ kind: 'highlight', instruction: '点击发布设置', targetId: 2 });
  expect(statuses.at(-1)?.kind).toBe('guiding');

  evidence = [heading];
  await session.refresh('user');
  expect(calls.at(-1)?.goal).toBe('请找到发布设置并确认发布成功');
  expect(statuses.at(-1)).toEqual({ kind: 'complete', text: '已发布' });
});

it('用户换页后晚返回的指引不会画到旧页面', async () => {
  let release!: (decision: Decision) => void;
  const pending = new Promise<Decision>(resolve => { release = resolve; });
  const applied: Decision[] = [];
  const page: GuidePage = {
    async snapshot() { return { title: 'Project', site: 'example.test', nodes: [button], truncated: false }; },
    async read() { return []; },
    async apply(decision) { applied.push(decision); return true; },
    trackScroll() {},
    clear() {},
  };
  const choose = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce({ kind: 'message', instruction: '新页面' });
  const session = createGuideSession('自然语言目标', { choose, report() {} });
  const first = session.attach(page);
  await vi.waitFor(() => expect(choose).toHaveBeenCalledTimes(1));
  await session.attach(page);
  release({ kind: 'highlight', instruction: '旧页面', targetId: 2 });
  await first;
  expect(applied).toEqual([]);
});

it('现场拒绝过期指引后重读页面，再判断筛选是否已生效', async () => {
  const filter: Evidence = { id: 8, label: 'Archived', role: 'checkbox', viewport: true, available: true, checked: false };
  let current = filter;
  const decisions: GuideRequest[] = [];
  const report = vi.fn();
  const page: GuidePage = {
    async snapshot() {
      return { title: 'Reports', site: 'example.test', nodes: [current], truncated: false };
    },
    async read() { return []; },
    async apply(result) {
      if (result.kind === 'highlight') {
        // 用户操作已生效，旧的操作提示应该失效。
        current = { ...filter, checked: true };
        return false;
      }
      return current.checked === true;
    },
    trackScroll() {},
    clear() {},
  };
  const session = createGuideSession('只看已归档报告', { report, async choose(input) {
    decisions.push(input);
    return input.page.nodes[0]?.checked
      ? { kind: 'complete', instruction: '筛选已生效', checks: [{ id: 8, field: 'checked', equals: true }] }
      : { kind: 'highlight', instruction: '勾选 Archived', targetId: 8 };
  } });
  await session.attach(page);
  expect(decisions.map(input => input.page.nodes[0]?.checked)).toEqual([false, true]);
  expect(report).toHaveBeenLastCalledWith({ kind: 'complete', text: '筛选已生效' });
});
