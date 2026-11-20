import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createModelNavigator } from '../src/model-navigation.js';
import type { NavigationInput } from '../src/navigation.js';

const origin = 'chrome-extension://' + 'a'.repeat(32);
const clientToken = 'local-test-token-at-least-24-chars';
const payload = {
  goal: '在 octo/project 打开 Issue #17',
  page: {
    path: '/octo/project',
    title: 'Repository overview',
    controls: [{ id: 3, label: 'Issues', role: 'link', path: '/octo/project/issues', expanded: false }],
  },
};
const headers = { host: '127.0.0.1:43130', origin, authorization: 'Bearer ' + clientToken };

describe('实时导航接口', () => {
  it('返回模型选择的页面控件，并拒绝快照里不存在的编号', async () => {
    const choose = vi.fn().mockResolvedValueOnce({ kind: 'highlight', targetId: 3, instruction: '打开 Issues。' })
      .mockResolvedValueOnce({ kind: 'highlight', targetId: 99, instruction: '旧页面的建议。' });
    const app = createApp({ choose, clientToken, origins: [origin] });
    try {
      const send = () => app.inject({ method: 'POST', url: '/api/v1/navigate', headers, payload });
      expect((await send()).json()).toEqual({ kind: 'highlight', targetId: 3, instruction: '打开 Issues。' });
      expect((await send()).statusCode).toBe(502);
      expect(choose).toHaveBeenCalledWith(payload);
    } finally {
      await app.close();
    }
  });

  it('拒绝无授权、非白名单来源、错误 Host 和不合格的请求体', async () => {
    const choose = vi.fn();
    const app = createApp({ choose, clientToken, origins: [origin] });
    try {
      for (const [requestHeaders, body, status] of [
        [{ ...headers, authorization: '' }, payload, 401],
        [{ ...headers, origin: 'https://example.org' }, payload, 403],
        [{ ...headers, host: 'example.org' }, payload, 403],
        [headers, { ...payload, modelUrl: 'https://example.org' }, 400],
      ] as const) {
        expect((await app.inject({ method: 'POST', url: '/api/v1/navigate', headers: requestHeaders, payload: body })).statusCode).toBe(status);
      }
      expect(choose).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('只为有效的复核接受保留，并要求调整说明原因', async () => {
    const keep = { kind: 'keep' };
    const change = { kind: 'highlight', targetId: 4, instruction: '打开目标 Issue。' };
    const choose = vi.fn().mockResolvedValueOnce(keep).mockResolvedValueOnce(keep)
      .mockResolvedValueOnce(change).mockResolvedValueOnce({ ...change, reason: '页面出现了目标 Issue。' });
    const app = createApp({ choose, clientToken, origins: [origin] });
    const page = { ...payload.page, controls: [...payload.page.controls,
      { id: 4, label: 'Target issue', role: 'link', path: '/octo/project/issues/17' }] };
    const review = { targetId: 3, instruction: '打开 Issues。', changedIds: [4] };
    const send = (body: NavigationInput) => app.inject({ method: 'POST', url: '/api/v1/navigate', headers, payload: body });
    try {
      expect((await send({ ...payload, page, review: { ...review, changedIds: [99] } })).statusCode).toBe(400);
      expect(choose).not.toHaveBeenCalled();
      expect((await send(payload)).statusCode).toBe(502);
      expect((await send({ ...payload, page, review })).json()).toEqual(keep);
      expect((await send({ ...payload, page, review })).statusCode).toBe(502);
      expect((await send({ ...payload, page, review })).json()).toMatchObject({ ...change, reason: '页面出现了目标 Issue。' });
    } finally {
      await app.close();
    }
  });

  it('预检只回显配置过的扩展来源', async () => {
    const app = createApp({ choose: vi.fn(), clientToken, origins: [origin] });
    try {
      const options = await app.inject({ method: 'OPTIONS', url: '/api/v1/navigate', headers: { host: headers.host, origin } });
      expect(options.statusCode).toBe(204);
      expect(options.headers['access-control-allow-origin']).toBe(origin);
    } finally {
      await app.close();
    }
  });
});

it('在服务端调用配置的模型，只把目标和页面快照放进模型消息', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    choices: [{ message: { content: '{"kind":"highlight","targetId":3,"instruction":"打开 Issues。"}' } }],
  }));
  const choose = createModelNavigator({ url: 'https://model.example/v1/chat/completions', name: 'test-model', key: 'upstream-test-key' }, request);
  expect(await choose(payload)).toMatchObject({ kind: 'highlight', targetId: 3 });
  const [url, options] = request.mock.calls[0];
  expect(url).toBe('https://model.example/v1/chat/completions');
  expect(options?.headers).toMatchObject({ authorization: 'Bearer upstream-test-key' });
  const body = JSON.parse(String(options?.body));
  expect(body.model).toBe('test-model');
  expect(JSON.parse(body.messages[1].content)).toEqual(payload);
});
