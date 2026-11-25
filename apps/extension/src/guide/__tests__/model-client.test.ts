import { afterEach, expect, it, vi } from 'vitest';
import { chooseGuide } from '../model-client.js';
import type { GuideRequest } from '../../../../api/src/guide-protocol.js';

const input: GuideRequest = {
  goal: '找到设置', page: { site: 'example.test', title: '练习页', nodes: [], truncated: false },
  reads: [], finishOnly: false,
};

afterEach(() => vi.restoreAllMocks());

it.each([
  ['request-deadline', 'TimeoutError'],
  ['round-deadline', 'TimeoutError'],
  ['guide-interrupted', 'AbortError'],
] as const)('记录浏览器取消原因 %s，并覆盖读取回复时的取消', async (outcome, name) => {
  const requestDeadline = new AbortController();
  const session = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(requestDeadline.signal);
  const report = vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const signal = init?.signal;
    return {
      ok: true,
      async json() {
        const source = outcome === 'request-deadline' ? requestDeadline : session;
        source.abort(new DOMException('private details', name));
        signal?.throwIfAborted();
      },
    } as Response;
  });
  await expect(chooseGuide(input, { url: 'https://model.example/v1/chat/completions', name: 'test-model', key: 'test-only-key' },
    session.signal)).rejects.toThrow();
  expect(report).toHaveBeenCalledExactlyOnceWith('[guide]', { outcome, elapsedMs: expect.any(Number) });
});
