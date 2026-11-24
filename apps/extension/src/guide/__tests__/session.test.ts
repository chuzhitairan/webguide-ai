import { expect, it, vi } from 'vitest';
import { chooseGuide } from '../model-client.js';
import { createGuideSession } from '../session.js';
import type { GuidePage, GuideStatus } from '../session.js';
import type { Decision, Evidence, GuideRequest, ReadQuery } from '../../../../api/src/guide-protocol.js';

const button: Evidence = { id: 2, label: 'Publish settings', role: 'button', viewport: true, available: true };
const heading: Evidence = { id: 5, label: 'Settings published', role: 'status', viewport: true, available: true };
const search: ReadQuery = { type: 'search', query: 'Publish' };
const inspect: ReadQuery = { type: 'inspect', id: 1 };

it('在同一轮用两个各需 12 秒的请求完成补看和高亮', async () => {
  vi.useFakeTimers();
  // 把原生超时信号接到测试时钟，无需实际等待模型。
  const deadlines = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('到期', 'TimeoutError')), ms);
    return controller.signal;
  });
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const input = JSON.parse(String(init?.body)) as GuideRequest;
    const signal = init?.signal;
    const decision: Decision = input.reads.length
      ? { kind: 'highlight', targetId: button.id, instruction: '打开发布设置。' }
      : { kind: 'observe', queries: [search] };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json(decision)), 12_000);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    });
  });
  const report = vi.fn();
  const apply = vi.fn<GuidePage['apply']>().mockResolvedValue(true);
  const session = createGuideSession('找到发布设置', {
    report, choose: (input, signal) => chooseGuide(input, 'test-token', signal),
  });
  try {
    const active = session.attach({
      async snapshot() { return { title: 'Project', site: 'example.test', nodes: [], truncated: true }; },
      async read() { return [{ query: search, nodes: [button], status: 'ok', truncated: false }]; },
      apply, async verify() { return true; }, trackScroll() {}, clear() {},
    });
    await vi.advanceTimersByTimeAsync(24_001);
    expect(apply).toHaveBeenCalledExactlyOnceWith({ kind: 'highlight', targetId: button.id, instruction: '打开发布设置。' });
    await active;
    expect(deadlines.mock.calls).toEqual([[45_000], [15_000], [15_000]]);
    expect(report).toHaveBeenLastCalledWith({ kind: 'guiding', text: '打开发布设置。' });
  } finally {
    session.detach();
    deadlines.mockRestore();
    fetch.mockRestore();
    vi.useRealTimers();
  }
});

it('找到正确入口时，一次回复同时给出条件和证据并结束', async () => {
  const verify = vi.fn().mockResolvedValue(true);
  const choose = vi.fn().mockResolvedValue({ kind: 'keep',
    requirements: [{ quote: '请找到发布设置', result: '找到发布设置', source: 'point' }],
    proofs: [{ index: 0, targetId: 2, checks: [{ id: 2, field: 'label', equals: button.label }] }],
  });
  const report = vi.fn();
  const session = createGuideSession('请找到发布设置', { choose, report });
  await session.attach({
    async snapshot() { return { title: 'Project', site: 'example.test', nodes: [button], truncated: false }; },
    async read() { return []; }, async apply() { return true; }, verify, trackScroll() {}, clear() {},
  });
  expect(choose).toHaveBeenCalledOnce();
  expect(verify).toHaveBeenCalledExactlyOnceWith([
    { source: 'point', targetId: 2, checks: [{ id: 2, field: 'label', equals: button.label }] },
  ], '已完成。找到发布设置。');
  expect(report).toHaveBeenLastCalledWith({ kind: 'complete', text: '已完成。找到发布设置。' });
});

it.each([true, false])('同一入口的两个目标先复查（能消除冲突：%s）', async canResolve => {
  const goal = '找到当前项目的发布入口';
  const row: Evidence = { id: 3, role: 'row', label: '当前项目', viewport: true, available: true, selected: true };
  const entry = { index: 0, targetId: button.id, checks: [{ id: button.id, field: 'label', equals: button.label }] } as const;
  const context = { index: 0, targetId: row.id, checks: [{ id: row.id, field: 'label', equals: row.label }] } as const;
  const entryProof = { ...entry, checks: [...entry.checks] };
  const conflicting = [entryProof, { ...context, checks: [...context.checks] }];
  const verify = vi.fn<GuidePage['verify']>().mockResolvedValue(true);
  const report = vi.fn();
  const choose = vi.fn<(input: GuideRequest) => Promise<Decision>>()
    .mockResolvedValueOnce({ kind: 'highlight', targetId: button.id, instruction: '这里是发布设置。',
      requirements: [{ quote: goal, result: '找到发布入口', source: 'point' }], proofs: conflicting,
    }).mockResolvedValue({ kind: 'keep', proofs: canResolve ? [entryProof] : conflicting });
  const session = createGuideSession(goal, { choose, report });
  await session.attach({
    async snapshot() { return { title: 'Project', site: 'example.test', nodes: [row, button], truncated: false }; },
    async read() { return []; }, async apply() { return true; }, verify, trackScroll() {}, clear() {},
  });
  expect(choose.mock.calls[1]?.[0].feedback).toContain('多个控件');
  if (canResolve) {
    expect(verify).toHaveBeenCalledExactlyOnceWith([
      { source: 'point', targetId: button.id, checks: entryProof.checks },
    ], '已完成。找到发布入口。');
    expect(report).toHaveBeenLastCalledWith({ kind: 'complete', text: '已完成。找到发布入口。' });
  } else {
    expect(verify).not.toHaveBeenCalled();
    expect(choose).toHaveBeenCalledTimes(3);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'paused' }));
  }
});

it('筛选已生效却卡在到达页面的条件时，可重新归并同一个网页结果', async () => {
  const goal = '打开活动记录，将筛选切成只看归档，筛选生效就行。';
  const title: Evidence = { ...heading, label: '活动记录', role: 'heading' };
  const selected: Evidence = { ...button, label: '范围：仅归档', expanded: false };
  const checks = [{ id: selected.id, field: 'label', equals: selected.label }] as const;
  const verify = vi.fn<GuidePage['verify']>().mockImplementation(async proofs =>
    proofs.every(proof => proof.checks.some(check => check.id === selected.id)));
  const report = vi.fn();
  const choose = vi.fn<(input: GuideRequest) => Promise<Decision>>()
    .mockResolvedValueOnce({ kind: 'keep',
      requirements: [
        { quote: '打开活动记录', result: '已打开活动记录', source: 'page' },
        { quote: '将筛选切成只看归档', result: '选中仅归档', source: 'page' },
        { quote: '筛选生效就行', result: '筛选已生效', source: 'page' },
      ],
      proofs: [
        { index: 0, checks: [{ id: title.id, field: 'label', equals: title.label }] },
        { index: 1, checks: [...checks] },
        { index: 2, checks: [...checks] },
      ],
    }).mockResolvedValueOnce({ kind: 'keep',
      requirements: [{ quote: goal, result: '活动记录已筛为仅归档', source: 'page' }],
      proofs: [{ index: 0, checks: [...checks] }],
    });
  const session = createGuideSession(goal, { choose, report });
  await session.attach({
    async snapshot() { return { title: title.label, site: 'example.test', nodes: [title, selected], truncated: false }; },
    async read() { return []; }, async apply() { return true; }, verify, trackScroll() {}, clear() {},
  });
  expect(choose.mock.calls[1]?.[0]).toMatchObject({ goal, reviewRequirements: true,
    feedback: '当前已通过下标 1、2，待核对下标 0。无需归并时，优先处理待核对项。' });
  expect(choose.mock.calls[1]?.[0].requirements).toHaveLength(3);
  expect(verify).toHaveBeenLastCalledWith([{ source: 'page', checks }], '已完成。活动记录已筛为仅归档。');
  expect(report).toHaveBeenLastCalledWith({ kind: 'complete', text: '已完成。活动记录已筛为仅归档。' });
});

it.each([true, false])('复核未归并的条件时，只保留当前仍可验证的证明 (%s)', async stillPublished => {
  const goal = '确认网页已发布，且已开启归档。';
  const published = { ...heading, label: '网页已发布' };
  const archiveHeading = { ...button, id: 7, role: 'heading', label: '归档设置' };
  const archive = { ...button, id: 8, role: 'checkbox', label: '归档', checked: true };
  const requirements = [
    { quote: '确认网页已发布，', result: '网页已发布', source: 'page' },
    { quote: '且已开启归档。', result: '已开启归档', source: 'page' },
  ] as const;
  const publishedCheck = { id: published.id, field: 'label', equals: published.label } as const;
  const archiveCheck = { id: archive.id, field: 'checked', equals: true } as const;
  const choose = vi.fn<(input: GuideRequest) => Promise<Decision>>()
    .mockResolvedValueOnce({ kind: 'keep', requirements: [...requirements], proofs: [
      { index: 0, checks: [publishedCheck] },
      { index: 1, checks: [{ id: archiveHeading.id, field: 'label', equals: archiveHeading.label }] },
    ] })
    .mockResolvedValueOnce({ kind: 'keep', proofs: [{ index: 1, checks: [archiveCheck] }] });
  const report = vi.fn();
  let snapshotCount = 0;
  const verify = vi.fn<GuidePage['verify']>().mockImplementation(async proofs => proofs.every(proof =>
    proof.checks.every(check => check.id === archive.id || (check.id === published.id && (snapshotCount === 1 || stillPublished)))));
  const session = createGuideSession(goal, { choose, report });
  await session.attach({
    async snapshot() {
      snapshotCount++;
      const status = stillPublished || snapshotCount === 1 ? published : { ...published, label: '网页尚未发布' };
      return { title: '设置', site: 'example.test', nodes: [status, archiveHeading, archive], truncated: false };
    },
    async read() { return []; }, async apply() { return true; }, verify, trackScroll() {}, clear() {},
  });

  expect(choose).toHaveBeenCalledTimes(2);
  expect(verify).toHaveBeenNthCalledWith(3, [{ source: 'page', checks: [publishedCheck] }]);
  expect(choose.mock.calls[1]?.[0].feedback).toContain(`当前已通过下标 ${stillPublished ? '0' : '无'}`);
  expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ kind: stillPublished ? 'complete' : 'paused' }));
  if (stillPublished) expect(verify).toHaveBeenLastCalledWith([
    { source: 'page', checks: [publishedCheck] }, { source: 'page', checks: [archiveCheck] },
  ], '已完成。网页已发布，已开启归档。');
});

it('页面证据只能完成网页部分，用户确认后仍须复查现场', async () => {
  const result: Decision = { kind: 'keep',
    requirements: [
      { quote: '确认发布成功', result: '网页已发布', source: 'page' },
      { quote: '并且收件人已收到通知', result: '收件人已收到通知', source: 'user' },
    ],
    proofs: [{ index: 0, checks: [{ id: 5, field: 'label', equals: heading.label }] }],
  };
  let evidence = [heading];
  const choose = vi.fn<() => Promise<Decision>>()
    .mockResolvedValueOnce(result).mockResolvedValue({ kind: 'message', instruction: '等待网页结果。' });
  const verify = vi.fn().mockImplementation(async () => evidence.length > 0);
  const report = vi.fn();
  const session = createGuideSession('确认发布成功并且收件人已收到通知', { choose, report });
  await session.attach({
    async snapshot() { return { title: 'Project', site: 'example.test', nodes: evidence, truncated: false }; },
    async read() { return []; }, async apply() { return true; }, verify, trackScroll() {}, clear() {},
  });
  expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'confirm', index: 1 }));
  evidence = [];
  await session.confirm(1);
  expect(verify).toHaveBeenCalledTimes(2);
  expect(report).toHaveBeenLastCalledWith({ kind: 'guiding', text: '等待网页结果。' });
  expect(report.mock.calls.some(([status]) => status.kind === 'complete')).toBe(false);
});

it('先展示一个入口，侧栏继续后再高亮下一处并完成', async () => {
  const share = { ...button, id: 3, label: 'Share' };
  const apply = vi.fn().mockResolvedValue(true);
  const verify = vi.fn().mockResolvedValue(true);
  const report = vi.fn();
  const choose = vi.fn().mockResolvedValue({ kind: 'keep', requirements: [
    { quote: '找到发布设置', result: '发布设置', source: 'point' },
    { quote: '和分享入口', result: '分享入口', source: 'point' },
  ], proofs: [button, share].map((item, index) => ({ index, targetId: item.id,
    checks: [{ id: item.id, field: 'label', equals: item.label }],
  })) });
  const session = createGuideSession('找到发布设置和分享入口', { choose, report });
  await session.attach({
    async snapshot() { return { title: 'Project', site: 'example.test', nodes: [button, share], truncated: false }; },
    async read() { return []; }, apply, verify, trackScroll() {}, clear() {},
  });
  expect(apply).toHaveBeenCalledExactlyOnceWith({ kind: 'highlight', targetId: button.id, instruction: '发布设置' });
  expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'confirm', source: 'point', index: 0 }));
  await session.confirm(0);
  expect(report).toHaveBeenLastCalledWith({ kind: 'complete', text: '已完成。发布设置，分享入口。' });
  expect(verify.mock.lastCall?.[0].at(-1).targetId).toBe(share.id);
  expect(choose).toHaveBeenCalledOnce();
});

it('确认中途的页面刷新不会盖住下一项确认，已确认进度可恢复', async () => {
  const goal = '确认甲收到邀请、乙也收到邀请';
  const requirements = [
    { quote: '确认甲收到邀请', result: '甲收到邀请', source: 'user' },
    { quote: '乙也收到邀请', result: '乙收到邀请', source: 'user' },
  ] as const;
  let release!: (accepted: boolean) => void;
  const waiting = new Promise<boolean>(resolve => { release = resolve; });
  const verify = vi.fn().mockResolvedValue(true).mockReturnValueOnce(Promise.resolve(true)).mockReturnValueOnce(waiting);
  const choose = vi.fn().mockResolvedValue({ kind: 'keep', requirements });
  const report = vi.fn();
  const saveProgress = vi.fn();
  const page: GuidePage = {
    async snapshot() { return { title: 'Project', site: 'example.test', nodes: [button], truncated: false }; },
    async read() { return []; }, async apply() { return true; }, verify, trackScroll() {}, clear() {},
  };
  const session = createGuideSession(goal, { choose, report, saveProgress });
  await session.attach(page);
  const confirming = session.confirm(0);
  await session.refresh('soft');
  release(true);
  await confirming;
  expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'user', index: 1 }));
  expect(choose).toHaveBeenCalledOnce();
  const input = vi.fn().mockResolvedValue({ kind: 'keep' });
  const resumed = createGuideSession(goal, { choose: input, report, progress: saveProgress.mock.lastCall?.[0] });
  await resumed.attach(page);
  expect(input).toHaveBeenCalledWith(expect.objectContaining({ requirements }), expect.any(AbortSignal));
  expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'user', index: 1 }));
});

it('组合目标可沿同一观察累积证据，仍在结束前复查两项', async () => {
  const requirements = [
    { quote: '网页已发布', result: '已发布', source: 'page' },
    { quote: '并且归档已开启', result: '已归档', source: 'page' },
  ];
  const checks = [{ id: 5, field: 'label', equals: heading.label }];
  const archived = { ...heading, id: 7, label: 'Archive enabled' };
  const choose = vi.fn().mockResolvedValueOnce({ kind: 'message', instruction: '查看归档状态。', requirements,
    proofs: [{ index: 0, checks }],
  }).mockResolvedValueOnce({ kind: 'keep', proofs: [{ index: 1, checks: [{ id: 7, field: 'label', equals: archived.label }] }] });
  const report = vi.fn();
  const verify = vi.fn().mockResolvedValue(true);
  const session = createGuideSession('网页已发布并且归档已开启', { choose, report });
  await session.attach({
    async snapshot() { return { title: 'Project', site: 'example.test', nodes: [heading, archived], truncated: false }; },
    async read() { return []; }, async apply() { return true; }, verify, trackScroll() {}, clear() {},
  });
  expect(report).toHaveBeenLastCalledWith({ kind: 'guiding', text: '查看归档状态。' });
  await session.refresh('soft');
  expect(verify.mock.lastCall?.[0]).toHaveLength(2);
  expect(report).toHaveBeenLastCalledWith({ kind: 'complete', text: '已完成。已发布，已归档。' });
});

it('需要网页外确认时，仍先让用户看见已找到的入口', async () => {
  const goal = '找到发布设置，并确认收件人已收到通知';
  let evidence = [button];
  const apply = vi.fn().mockResolvedValue(true);
  const verify = vi.fn().mockResolvedValue(true);
  const report = vi.fn();
  const choose = vi.fn().mockResolvedValueOnce({ kind: 'keep', requirements: [
    { quote: '找到发布设置', result: '发布设置入口', source: 'point' },
    { quote: '并确认收件人已收到通知', result: '收件人已收到通知', source: 'user' },
  ], proofs: [{ index: 0, targetId: button.id, checks: [{ id: button.id, field: 'label', equals: button.label }] }],
  }).mockResolvedValue({ kind: 'message', instruction: '等待确认。' });
  const session = createGuideSession(goal, { choose, report });
  await session.attach({
    async snapshot() { return { title: 'Project', site: 'example.test', nodes: evidence, truncated: false }; },
    async read() { return []; }, apply, verify, trackScroll() {}, clear() {},
  });
  expect(apply).toHaveBeenCalledExactlyOnceWith({ kind: 'highlight', targetId: button.id, instruction: '发布设置入口' });
  expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'confirm', source: 'user', index: 1 }));
  evidence = [];
  await session.refresh('user');
  await session.confirm(1);
  expect(verify).toHaveBeenLastCalledWith([], '已完成。发布设置入口，收件人已收到通知（由你确认）。');
});

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
    async verify() { return true; },
    trackScroll() {},
    clear() {},
  };
  const statuses: GuideStatus[] = [];
  const session = createGuideSession('请确认发布成功', {
    report(status) { statuses.push(status); },
    async choose(input) {
      calls.push(input);
      if (input.page.nodes.some(node => node.id === 5)) {
        return { kind: 'keep', proofs: [{ index: 0, checks: [{ id: 5, field: 'label', equals: 'Settings published' }] }] };
      }
      return input.reads.length > 0
        ? { kind: 'highlight', instruction: '点击发布设置', targetId: 2 }
        : { kind: 'observe', queries: [search, inspect],
          requirements: [{ quote: '请确认发布成功', result: '已发布', source: 'page' }] };
    },
  });
  await session.attach(page);
  expect(calls).toHaveLength(2);
  expect(calls[1].reads).toHaveLength(2);
  expect(apply).toHaveBeenCalledExactlyOnceWith({ kind: 'highlight', instruction: '点击发布设置', targetId: 2 });
  expect(statuses.at(-1)?.kind).toBe('guiding');

  evidence = [heading];
  await session.refresh('user');
  expect(calls.at(-1)?.goal).toBe('请确认发布成功');
  expect(calls[1].requirements).toEqual([{ quote: '请确认发布成功', result: '已发布', source: 'page' }]);
  expect(statuses.at(-1)).toEqual({ kind: 'complete', text: '已完成。已发布。' });
});

it('用户换页后晚返回的指引不会画到旧页面', async () => {
  let release!: (decision: Decision) => void;
  const pending = new Promise<Decision>(resolve => { release = resolve; });
  const applied: Decision[] = [];
  const page: GuidePage = {
    async snapshot() { return { title: 'Project', site: 'example.test', nodes: [button], truncated: false }; },
    async read() { return []; },
    async apply(decision) { applied.push(decision); return true; },
    async verify() { return true; },
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
    async apply() {
      // 用户操作已生效，旧的操作提示应该失效。
      current = { ...filter, checked: true };
      return false;
    },
    async verify() { return current.checked === true; },
    trackScroll() {},
    clear() {},
  };
  const session = createGuideSession('只看已归档报告', { report, async choose(input) {
    decisions.push(input);
    return input.page.nodes[0]?.checked
      ? { kind: 'keep', proofs: [{ index: 0, checks: [{ id: 8, field: 'checked', equals: true }] }] }
      : { kind: 'highlight', instruction: '勾选 Archived', targetId: 8,
        requirements: [{ quote: '只看已归档报告', result: '筛选已生效', source: 'page' }] };
  } });
  await session.attach(page);
  expect(decisions.map(input => input.page.nodes[0]?.checked)).toEqual([false, true]);
  expect(report).toHaveBeenLastCalledWith({ kind: 'complete', text: '已完成。筛选已生效。' });
});
