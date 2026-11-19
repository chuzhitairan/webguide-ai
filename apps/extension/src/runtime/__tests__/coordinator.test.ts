import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Effect } from '@webguide/contracts';
import { binding, harness, owner, page } from './helpers.js';
import { createCoordinator } from '../coordinator.js';
import { currentEvidence } from '../evidence.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { vi.useRealTimers(); });

describe('会话唯一写者', () => {
  it('暂停接受落后的 UI 修订，迟到的成功无法恢复采集，STOP 只由原文档确认', async () => {
    const h = harness();
    await h.start(); await h.hello();
    const request = h.request();
    expect((await h.command('USER_PAUSE', owner, 0)).status).toBe('accepted');
    expect((await h.result(true, 'ok', request)).status).toBe('rejected');
    expect(h.snap()).toMatchObject({ state: 'paused', owner: null, stopStatus: { pendingBindings: [binding.id] } });
    const stop = h.effects.filter(e => e.type === 'STOP').at(-1)!;
    if (stop.type !== 'STOP') throw Error('missing stop');
    const ack = { ...stop, type: 'STOP_ACK', status: 'stopped' } as const;
    expect((await h.coordinator.handle({ ...ack, contextRevision: ack.contextRevision - 1 }, page())).status).toBe('rejected');
    expect((await h.coordinator.handle(ack, page({ ...binding, documentId: 'another' }))).status).toBe('rejected');
    await h.coordinator.handle(ack, page());
    expect(h.snap().stopStatus.pendingBindings).toEqual([]);
  });

  it('普通命令冲突返回当前修订，重复 messageId 只执行一次', async () => {
    const h = harness(); await h.start();
    expect(await h.command('USER_RECHECK', owner, 0)).toMatchObject({ status: 'conflict' });
    const startRevision = h.snap().sessionRevision;
    expect((await h.start()).snapshot?.sessionRevision).toBe(startRevision);
    expect(h.records.size).toBe(1);
  });

  it('不同 epoch、owner、绑定或检查序号不能写入，失效的文档不能覆盖新文档', async () => {
    const h = harness(); await h.start(); await h.hello();
    const req = h.request(), rev = h.snap().sessionRevision;
    for (const change of [{ coordinatorEpoch: 'old' }, { checkSequence: 0 }, { requestId: 'x' },
      { targetRevision: 2 }, { tutorialIdentity: { ...req.tutorialIdentity, contentHash: 'bad' } },
      { navigationRevision: 0 }, { bindingId: 'old' }]) {
      expect((await h.result(true, 'ok', { ...req, ...change })).status).toBe('rejected');
    }
    expect((await h.command('USER_PAUSE', { ...owner, uiInstanceId: 'other' })).status).toBe('rejected');
    expect(h.snap().sessionRevision).toBe(rev);
    await h.hello({ ...binding, id: 'new', documentId: 'new' });
    expect((await h.result(true, 'ok', req)).status).toBe('rejected');
  });

  it('返回查看只重查展示步骤，继续才回到 frontier，终验独立判断交接阻塞', async () => {
    const h = harness(); await h.start(); await h.hello(); await h.result(true);
    expect(h.snap()).toMatchObject({ displayStepId: 'submit', frontierStepId: 'submit' });
    await h.command('USER_BACK'); await h.result(true);
    expect(h.snap()).toMatchObject({ displayStepId: 'read', frontierStepId: 'submit', navigationIntent: 'review', result: null });
    await h.command('USER_ADVANCE');
    h.decide.mockImplementation(input => ({ status: input.final ? 'blocked' : 'pass', evidenceIds: input.observations.map(o => o.id),
      reasonCodes: input.final ? ['submission-verified', 'checks-failed'] : [], missing: [], conflicts: [] }));
    await h.result(true);
    expect(h.snap()).toMatchObject({ displayStepId: 'submit', state: 'blocked', result: null,
      decision: { reasonCodes: ['submission-verified', 'checks-failed'] } });
    expect(h.evaluations.at(-1)).toMatchObject({ final: true, checkerId: 'final' });
    h.decide.mockImplementation(input => ({ status: 'pass', evidenceIds: input.observations.map(o => o.id), reasonCodes: [], missing: [], conflicts: [] }));
    await h.command('USER_RECHECK'); await h.result(true);
    expect(h.snap()).toMatchObject({ state: 'ended', result: 'system-verified' });
  });

  it('重查开始即撤销同范围旧证据，读取失败不会回到旧成功', async () => {
    const h = harness(); await h.start(); await h.hello(); await h.result(false);
    const old = h.snap().observations[0]!.id;
    await h.command('USER_RECHECK');
    expect(currentEvidence(h.snap(), Date.now()).map(o => o.id)).not.toContain(old);
    await h.result(false, 'read-error');
    expect(h.snap().state).toBe('pending');
    expect(h.evaluations.at(-1)!.observations.map(o => o.id)).not.toContain(old);
  });

  it('离开页面时撤销读取权限，在证据过期前允许下一页使用已读取的结果', async () => {
    const h = harness(); await h.start(); await h.hello(); await h.result(false);
    const request = h.request();
    const observation = h.snap().observations[0]!;
    await h.coordinator.handle({ type: 'LOCATION_INVALIDATED', request, reason: 'page-left' }, page());

    expect(h.snap().bindings).toEqual([]);
    expect(h.effects).toContainEqual(expect.objectContaining({ type: 'CANCEL_REQUEST', requestId: request.requestId }));
    expect((await h.result(true, 'ok', request)).status).toBe('rejected');
    expect(currentEvidence(h.snap(), Date.now())).toEqual([observation]);
  });

  it('3000 ms 未回复即超时，邻近时刻的迟到回包不能生效', async () => {
    const h = harness(); await h.start(); await h.hello();
    const req = h.request();
    await vi.advanceTimersByTimeAsync(2999);
    expect(h.snap().state).toBe('checking');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.snap().state).toBe('pending');
    expect((await h.result(true, 'ok', req)).status).toBe('rejected');
  });

  it('重查和暂停撤销页面指示，合法续期每 2 秒仅延长当前引导', async () => {
    const h = harness(); await h.start(); await h.hello(); await h.result(false);
    const shows = () => h.effects.filter(e => e.type === 'SHOW_GUIDE');
    expect(shows()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(shows()).toHaveLength(2);
    expect(shows()[1]).toMatchObject({ leaseMs: 6000 });
    await h.command('USER_PAUSE'); await vi.advanceTimersByTimeAsync(6000);
    expect(shows()).toHaveLength(2);
  });

  it('存储异常只发布保守停止，保留上一个已提交的证据', async () => {
    const h = harness(); await h.start(); await h.hello();
    vi.spyOn(h.store, 'write').mockRejectedValueOnce(Error('quota'));
    const cursor = h.effects.length;
    expect((await h.result()).status).toBe('rejected');
    const tail = h.effects.slice(cursor).map(e => e.type);
    expect(tail).not.toContain('SHOW_GUIDE'); expect(tail).toContain('STOP');
    expect(h.snap()).toMatchObject({ state: 'paused', owner: null, observations: [] });
    expect(h.publications.at(-1)?.state).toBe('paused');
  });

  it('后台恢复活动任务进入待恢复暂停，旧请求和旧界面断线均不影响新 owner', async () => {
    const h = harness(); await h.start(); await h.hello();
    const next = createCoordinator(h.deps); await next.recover();
    expect(next.snapshot()).toMatchObject({ state: 'paused', owner: null, endedReason: 'recovery-required' });
    const sender = { ...owner, uiInstanceId: 'new' };
    await next.handle({ type: 'USER_CONTINUE', coordinatorEpoch: next.epoch, taskId: h.snap().taskId,
      expectedSessionRevision: next.snapshot()!.sessionRevision, messageId: 'continue' }, sender);
    await next.handle({ type: 'UI_LOST' }, owner);
    expect(next.snapshot()?.owner?.uiInstanceId).toBe('new');
    expect((await next.handle({ type: 'CHECK_TIMEOUT', request: h.request() }, { kind: 'system' })).status).toBe('rejected');
  });

  it('会话保留 5 个任务后拒绝第 6 个，任务记录不被静默删除', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) { await h.start('m' + i); await h.command('USER_PAUSE'); }
    expect((await h.start('m5')).status).toBe('rejected');
    expect(h.records.size).toBe(5);
  });

  it('有效历史仍满 100 条时拒绝新增并暂停，仍能显式结束', async () => {
    const h = harness(); await h.start(); await h.hello(); await h.result();
    const seed = h.snap(), example = seed.observations[0]!;
    seed.observations = Array.from({ length: 100 }, (_, i) => ({ ...example, id: 'obs' + i, objectKey: 'prior' + i }));
    const full = harness([seed]); await full.coordinator.recover();
    await full.command('USER_CONTINUE'); await full.hello(); await full.result();
    expect(full.snap()).toMatchObject({ state: 'paused', observations: { length: 100 } });
    expect(full.snap().decision?.reasonCodes).toContain('capacity-exceeded');
    await full.command('EXIT');
    expect(full.snap().state).toBe('ended');
  });

  it('慢页面不占住事件队列，写入检查点之后才允许读取', async () => {
    const h = harness();
    const seen: string[] = [];
    const c = createCoordinator({ ...h.deps, emit: (e: Effect) => {
      if (e.type === 'CHECK_REQUEST') { seen.push(h.records.get(e.taskId)!.state); return new Promise<void>(() => {}); }
    } });
    const started = await c.handle({ type: 'USER_START', coordinatorEpoch: c.epoch, messageId: 's',
      tutorialId: 'sample', version: '1', target: (await h.start()).snapshot!.target }, owner);
    await c.handle({ type: 'PAGE_HELLO', binding }, page());
    expect(seen).toEqual(['checking']);
    await c.handle({ type: 'USER_PAUSE', coordinatorEpoch: c.epoch, taskId: started.snapshot!.taskId,
      messageId: 'p', expectedSessionRevision: 0 }, owner);
    expect(c.snapshot()?.state).toBe('paused');
  });

  it('分支起点由当前观察固定，锚点只能由用户核对有效候选后确认', async () => {
    const h = harness(); await h.start(); await h.hello();
    const sha = 'b'.repeat(40);
    h.decide.mockImplementation(input => {
      const id = input.observations.at(-1)!.id;
      return { status: 'unknown', reasonCodes: [], evidenceIds: [id], missing: [], conflicts: [],
        branchStart: { sha: 'a'.repeat(40), sourceObservationIds: [id] },
        commitCandidate: { sha, sourceObservationIds: [id] } };
    });
    await h.result();
    expect(h.snap().target).toMatchObject({ branchStart: { sha: 'a'.repeat(40) }, commitAnchor: null });
    const confirm = (value: string) => h.coordinator.handle({ type: 'USER_CONFIRM_ANCHOR',
      sha: value, taskId: h.snap().taskId, coordinatorEpoch: h.coordinator.epoch,
      messageId: value, expectedSessionRevision: h.snap().sessionRevision }, owner);
    expect((await confirm('f'.repeat(40))).status).toBe('rejected');
    await confirm(sha);
    expect(h.snap().target).toMatchObject({ targetRevision: 1, commitAnchor: { sha, confirmedAt: Date.now() } });
  });

  it('STOP 后失联记录为未获确认，不能当作 ACK', async () => {
    const h = harness(); await h.start(); await h.hello(); await h.command('USER_PAUSE');
    await h.coordinator.handle({ type: 'PAGE_LOST', bindingId: binding.id }, { kind: 'system' });
    expect(h.snap().stopStatus).toMatchObject({ pendingBindings: [], failedBindings: [binding.id] });
  });

  it('首次持久化失败就撤销采集，即使保守暂停的写回尚在等待', async () => {
    const h = harness(); await h.start(); await h.hello();
    let finish: () => void = () => {};
    vi.spyOn(h.store, 'write').mockRejectedValueOnce(Error('quota')).mockImplementationOnce(
      () => new Promise<void>(resolve => { finish = resolve; }));
    const saving = h.result();
    await vi.advanceTimersByTimeAsync(0);
    const stoppedBeforeRetryFinished = h.effects.some(effect => effect.type === 'STOP');
    finish(); await saving;
    expect(stoppedBeforeRetryFinished).toBe(true);
  });

  it('会话距离 1 MiB 不足时优先清理其他暂停任务中已过期且未引用的观察', async () => {
    const h = harness(); await h.start(); await h.hello(); await h.result(); await h.command('USER_PAUSE');
    const prior = h.snap(); prior.taskId = 'archive'; prior.stepChecks = {}; prior.decision = null;
    const o = prior.observations[0]!;
    o.taskId = 'archive'; o.expiresAt = Date.now();
    const baseline = new TextEncoder().encode(JSON.stringify(prior)).length;
    o.payload.padding = 'x'.repeat(1024 * 1024 - baseline - 300);
    const next = harness([prior]); await next.coordinator.recover();
    expect((await next.start('different')).status).toBe('accepted');
    expect(next.records.get('archive')!.observations).toEqual([]);
    expect(next.records.size).toBe(2);
  });

});
