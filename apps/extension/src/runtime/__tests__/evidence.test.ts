import { expect, it } from 'vitest';
import { harness } from './helpers.js';
import { currentEvidence } from '../evidence.js';
import { fitCheckpoint } from '../limits.js';

it('只采用本任务、本版本、同教程、尚未到期的成功观察', async () => {
  const h = harness(); await h.start(); await h.hello(); await h.result();
  const s = h.snap(), o = s.observations[0]!;
  s.observations.push({ ...o, id: 'foreign', taskId: 'outside' },
    { ...o, id: 'other-target', targetRevision: 2 }, { ...o, id: 'other-tutorial', tutorialIdentity: { ...s.tutorial, contentHash: 'bad' } },
    { ...o, id: 'obsolete', invalidatedReason: 'updated' }, { ...o, id: 'unknown', status: 'unknown' });
  expect(currentEvidence(s, o.observedAt + 299999).map(e => e.id)).toEqual([o.id]);
  expect(currentEvidence(s, o.observedAt + 300000)).toEqual([]);
});

it('容量不足时仅清理已过期或已失效且未引用的历史，按 UTF-8 统计会话总量', async () => {
  const h = harness(); await h.start(); await h.hello(); await h.result();
  const s = h.snap(), original = s.observations[0]!;
  s.observations = Array.from({ length: 101 }, (_, i) => ({ ...original, id: 'obs' + i }));
  s.observations[0]!.invalidatedReason = 'superseded';
  s.observations[1]!.expiresAt = 1;
  s.decision!.evidenceIds = ['obs0'];
  expect(fitCheckpoint(s, [], Date.now())).toBe(true);
  expect(s.observations.map(o => o.id)).toContain('obs0');
  expect(s.observations.map(o => o.id)).not.toContain('obs1');
  const other = structuredClone(s);
  other.observations = [];
  other.taskId = 'other';
  other.endedReason = '中'.repeat(346000);
  s.observations[0]!.payload = { sample: '中'.repeat(5000) };
  expect(fitCheckpoint(s, [other], Date.now())).toBe(false);
});
