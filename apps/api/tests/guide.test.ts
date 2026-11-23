import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const token = 'test-client-token-for-guide-api';
const headers = { host: '127.0.0.1:43130', origin, authorization: 'Bearer ' + token };
const url = '/api/v1/guide';
const payload = {
  goal: '找到属性栏里的导出选项',
  page: {
    title: '设计练习',
    site: 'design.example',
    nodes: [{ id: 1, role: 'region', label: '属性栏', viewport: true, available: true }],
    truncated: true,
  },
  reads: [],
  finishOnly: false,
};

const apps: ReturnType<typeof createApp>[] = [];
function service(decide: NonNullable<Parameters<typeof createApp>[0]>['decide'], origins = [origin]) {
  const app = createApp({ token, origins, decide });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});

describe('引导接口', () => {
  it('只返回已验证的一项模型决定', async () => {
    const app = service(async (input, signal) => {
      expect(input).toEqual(payload);
      expect(signal.aborted).toBe(false);
      return { kind: 'observe', queries: [{ type: 'region', id: 1, includeOffscreen: true }] };
    });
    const result = await app.inject({ method: 'POST', url, headers, payload });
    expect(result.statusCode).toBe(200);
    expect(result.headers['access-control-allow-origin']).toBe(origin);
    expect(result.json()).toEqual({
      kind: 'observe',
      queries: [{ type: 'region', id: 1, includeOffscreen: true }],
    });
  });

  it.each([
    ['错误令牌', { ...headers, authorization: 'Bearer wrong' }, 401],
    ['缺少来源', { host: headers.host, authorization: headers.authorization }, 403],
    ['网页来源', { ...headers, origin: 'https://design.example' }, 403],
    ['未允许的扩展来源', { ...headers, origin: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }, 403],
    ['非回环主机', { ...headers, host: 'design.example' }, 403],
  ] as const)('拦截%s的引导请求', async (_name, invalidHeaders, status) => {
    let called = false;
    const app = service(async () => {
      called = true;
      return { kind: 'message', instruction: '查看属性栏。' };
    });
    const result = await app.inject({ method: 'POST', url, headers: invalidHeaders, payload });
    expect(result.statusCode).toBe(status);
    expect(result.json()).toEqual({ error: expect.any(String) });
    expect(called).toBe(false);
  });

  it('仅为已允许的扩展声明预检许可', async () => {
    const app = service(async () => ({ kind: 'keep' }));
    const result = await app.inject({
      method: 'OPTIONS',
      url,
      headers: { host: headers.host, origin, 'access-control-request-method': 'POST' },
    });
    expect(result.statusCode).toBe(204);
    expect(result.headers['access-control-allow-origin']).toBe(origin);
    expect(result.headers['access-control-allow-headers']).toMatch(/authorization/i);
  });

  it.each([
    { ...payload, goal: ' ' },
    { ...payload, page: { ...payload.page, nodes: [{ ...payload.page.nodes[0], available: 'true' }] } },
    { ...payload, page: { ...payload.page, url: 'https://design.example/private?token=secret' } },
    { ...payload, page: { ...payload.page, nodes: Array.from({ length: 1000 }, () => payload.page.nodes[0]) } },
  ])('拒绝无效或超限的观察证据', async (input) => {
    let called = false;
    const app = service(async () => {
      called = true;
      return { kind: 'keep' };
    });
    const result = await app.inject({ method: 'POST', url, headers, payload: input });
    expect(result.statusCode).toBe(400);
    expect(result.json()).toEqual({ error: expect.any(String) });
    expect(called).toBe(false);
  });

  it('拒绝超出 HTTP 字节上限的请求', async () => {
    const app = service(async () => ({ kind: 'keep' }));
    const result = await app.inject({ method: 'POST', url, headers, payload: { ...payload, goal: 'x'.repeat(200_000) } });
    expect(result.statusCode).toBe(413);
    expect(result.json()).toEqual({ error: expect.any(String) });
  });

  it.each([
    { kind: 'click', targetId: 1 },
    { kind: 'highlight', targetId: 2, instruction: '查看导出。' },
    { kind: 'observe', queries: [{ type: 'inspect', id: 2 }] },
    { kind: 'complete', instruction: '已找到设置。', checks: [] },
    { kind: 'complete', instruction: '已展开。', checks: [{ id: 1, field: 'expanded', equals: 'true' }] },
  ])('拦截无效的模型决定', async (decision) => {
    const app = service(async () => decision);
    const result = await app.inject({ method: 'POST', url, headers, payload });
    expect(result.statusCode).toBe(502);
    expect(result.json()).toEqual({ error: expect.any(String) });
  });

  it('接受同一轮补看中找到的编号', async () => {
    const app = service(async () => ({ kind: 'highlight', targetId: 2, instruction: '查看导出。' }));
    const result = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: {
        ...payload,
        reads: [{
          query: { type: 'region', id: 1, includeOffscreen: true },
          nodes: [{ id: 2, role: 'button', label: '导出', viewport: true, available: true, region: 1 }],
          truncated: false,
          status: 'ok',
        }],
      },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ kind: 'highlight', targetId: 2, instruction: '查看导出。' });
  });

  it('同一条引导回复可附用户目标的条件和当前证据', async () => {
    const requirements = [{ quote: payload.goal, result: '找到导出选项', source: 'point' }];
    const proofs = [{ index: 0, targetId: 1, checks: [{ id: 1, field: 'label', equals: '属性栏' }] }];
    const decision = { kind: 'keep', requirements, proofs };
    const app = service(async () => decision);
    const result = await app.inject({ method: 'POST', url, headers, payload: { ...payload, requirements: [] } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual(decision);
  });

  it('已明确的条件保持不变，网页只能提交它能证明的部分', async () => {
    const requirements = [{ quote: '请确认已下载到电脑', result: '文件存在于本机', source: 'user' }];
    const input = { ...payload, goal: '请确认已下载到电脑', requirements };
    const app = service(async () => ({ kind: 'message', instruction: '检查下载文件。',
      requirements: [{ ...requirements[0], source: 'page' }],
      proofs: [{ index: 0, checks: [{ id: 1, field: 'label', equals: '属性栏' }] }],
    }));
    const result = await app.inject({ method: 'POST', url, headers, payload: input });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ kind: 'message', instruction: '检查下载文件。' });
  });

  it('漏掉原话后半段时只保留普通引导', async () => {
    const app = service(async () => ({ kind: 'message', instruction: '看导出状态。',
      requirements: [{ quote: '确认导出成功', result: '已导出', source: 'page' }],
      proofs: [{ index: 0, checks: [{ id: 1, field: 'label', equals: '属性栏' }] }],
    }));
    const result = await app.inject({ method: 'POST', url, headers, payload: {
      ...payload, goal: '确认导出成功并且已下载到电脑', requirements: [],
    } });
    expect(result.json()).toEqual({ kind: 'message', instruction: '看导出状态。' });
  });

  it('启用逐项核对时，普通完成决定不能跳过条件', async () => {
    const app = service(async () => ({ kind: 'complete', instruction: '已下载。',
      checks: [{ id: 1, field: 'label', equals: '属性栏' }],
    }));
    const result = await app.inject({ method: 'POST', url, headers, payload: { ...payload, requirements: [] } });
    expect(result.statusCode).toBe(502);
  });

  it('最后一次判断不接受新的补看要求', async () => {
    const app = service(async () => ({ kind: 'observe', queries: [{ type: 'inspect', id: 1 }] }));
    const result = await app.inject({ method: 'POST', url, headers, payload: { ...payload, finishOnly: true } });
    expect(result.statusCode).toBe(502);
    expect(result.json()).toEqual({ error: expect.any(String) });
  });

  it('返回可识别的模型故障且不透传上游异常', async () => {
    const app = service(async () => {
      throw new Error('upstream-private-data');
    });
    const result = await app.inject({ method: 'POST', url, headers, payload });
    expect(result.statusCode).toBe(502);
    expect(result.json()).toEqual({ error: expect.any(String) });
    expect(result.body).not.toContain('upstream-private-data');
  });

  it('即使上游仍在等待，也会按时结束请求', async () => {
    const timeout = new AbortController();
    const deadline = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(timeout.signal);
    const app = service(async () => {
      queueMicrotask(() => timeout.abort());
      return await new Promise(() => {});
    });
    try {
      const result = await app.inject({ method: 'POST', url, headers, payload });
      expect(result.statusCode).toBe(504);
      expect(result.json()).toEqual({ error: expect.any(String) });
    } finally {
      deadline.mockRestore();
    }
  }, 1500);

  it('浏览器取消请求后中止上游判断', async () => {
    const onAbort = vi.fn();
    const app = service(async (_input, signal) => {
      await new Promise<void>(resolve => {
        signal.addEventListener('abort', () => {
          onAbort();
          resolve();
        }, { once: true });
      });
    });
    app.addHook('preHandler', async (_request, reply) => {
      // 模拟请求体已经被读取、模型仍在等待时关闭浏览器连接。
      setImmediate(() => reply.raw.destroy());
    });
    await expect(app.inject({ method: 'POST', url, headers, payload }))
      .rejects.toMatchObject({ code: 'LIGHT_ECONNRESET' });
    expect(onAbort).toHaveBeenCalledOnce();
  });
});
