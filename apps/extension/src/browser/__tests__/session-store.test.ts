import { expect, it } from 'vitest';
import { harness } from '../../runtime/__tests__/helpers.js';
import { createSessionStore } from '../session-store.js';

it('每个任务独立保存、读取和清除，其他扩展状态保留', async () => {
  const entries: Record<string, unknown> = { unrelated: 'keep' };
  const store = createSessionStore({
    async get() { return structuredClone(entries); },
    async set(items) { Object.assign(entries, structuredClone(items)); },
    async remove(key) { delete entries[key]; },
  });
  const h = harness(); await h.start();
  const one = h.snap(), two = { ...one, taskId: 'task-2' };
  await store.write(one); await store.write(two);
  expect((await store.readAll()).map(s => s.taskId)).toEqual([one.taskId, two.taskId]);
  await store.remove(one.taskId);
  expect(await store.readAll()).toEqual([two]);
  const key = Object.keys(entries).find(k => k !== 'unrelated')!;
  entries[key] = { ...two, checkpointSchema: 42 };
  await expect(store.readAll()).rejects.toThrow();
  expect(entries.unrelated).toBe('keep');
});
