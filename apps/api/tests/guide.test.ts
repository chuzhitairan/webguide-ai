import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadExperienceCatalog } from '../src/experience.js';
import { createModelGuide } from '../src/guide.js';

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
function service(decide: NonNullable<Parameters<typeof createApp>[0]>['decide'], origins = [origin],
  report?: Parameters<typeof createApp>[1]) {
  const app = createApp({ token, origins, decide }, report);
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});

describe('引导接口', () => {
  it('按开关和主机名只给模型发送本站的经验摘要，控件仍要用当前编号', async () => {
    const catalog = loadExperienceCatalog();
    const messages: { role: string; content: string }[][] = [];
    const report = vi.fn();
    const decide = createModelGuide({ url: 'https://model.example/v1/chat/completions', name: 'test-model', key: 'test-only' },
      async (_url, request) => {
        const body = JSON.parse(String(request?.body));
        messages.push(body.messages);
        return Response.json({ choices: [{ message: { content: '{"kind":"highlight","targetId":2,"instruction":"查看导出。"}' } }] });
      });
    const baseline = service(decide);
    const trial = createApp({ token, origins: [origin], decide, catalog }, report);
    apps.push(trial);
    const figma = { ...payload, page: { ...payload.page, site: 'www.figma.com' } };
    for (const [app, input] of [[baseline, figma], [trial, figma], [trial, payload]] as const) {
      // 编号 2 在当前页面和补看里都没有出现，经验开启后也应拒绝。
      expect((await app.inject({ method: 'POST', url, headers, payload: input })).statusCode).toBe(502);
    }

    expect(messages[0].slice(0, 2)).toEqual(messages[1].slice(0, 2));
    const entry = catalog.entries.find(item => item.hostname === 'www.figma.com')!;
    const baselineEvidence = JSON.parse(messages[0][2].content);
    expect(baselineEvidence.experience).toEqual([]);
    expect(JSON.parse(messages[1][2].content)).toEqual({ ...baselineEvidence,
      experience: [{ goal: entry.goal, when: entry.when, advice: entry.advice, check: entry.check }] });
    expect(JSON.parse(messages[2][2].content).experience).toEqual([]);
    expect(report).toHaveBeenNthCalledWith(1, expect.objectContaining({ experienceVersion: catalog.version,
      experienceEntries: [`${entry.id}@${entry.revision}`], outcome: 'decision-rejected' }));
    expect(report).toHaveBeenNthCalledWith(2, expect.objectContaining({ experienceEntries: [] }));
  });

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
    { kind: 'highlight', targetId: 1, scopeId: 2, instruction: '查看导出。' },
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
    const app = service(async () => ({ kind: 'highlight', targetId: 2, scopeId: 1, instruction: '查看导出。' }));
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
    expect(result.json()).toEqual({ kind: 'highlight', targetId: 2, scopeId: 1, instruction: '查看导出。' });
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

  it('最终指引从当前观察构造入口证明，模型只需选择目标', async () => {
    const app = service(async () => ({ kind: 'point', targetId: 2, scopeId: 1,
      requirements: [{ start: null, result: '找到导出按钮', source: 'point' }] }));
    const result = await app.inject({ method: 'POST', url, headers, payload: {
      ...payload, requirements: [], reads: [{ query: { type: 'region', id: 1 }, status: 'ok', truncated: false,
        nodes: [{ id: 2, role: 'button', label: '导出', viewport: true, available: true, region: 1 }] }],
    } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ kind: 'highlight', targetId: 2, scopeId: 1, instruction: '找到导出按钮',
      requirements: [{ quote: payload.goal, result: '找到导出按钮', source: 'point' }],
      proofs: [{ index: 0, targetId: 2, checks: [
        { id: 2, field: 'label', equals: '导出' }, { id: 1, field: 'label', equals: '属性栏' },
      ] }],
    });
  });

  it('多项任务要求给出入口对应的下标，并保留其他项的独立证明', async () => {
    const requirements = [
      { quote: '确认同步已生效', result: '同步已生效', source: 'page' },
      { quote: '并找到导出入口', result: '找到导出入口', source: 'point' },
    ];
    const proof = { index: 0, checks: [{ id: 2, field: 'checked', equals: true }] };
    const point = { kind: 'point', targetId: 3, proofs: [proof] };
    const app = service(async input => input.finishOnly ? { ...point, index: 1 } : point);
    const input = { ...payload, goal: requirements.map(item => item.quote).join(''), requirements,
      page: { ...payload.page, nodes: [
        ...payload.page.nodes, { id: 2, role: 'checkbox', label: '同步', checked: true, viewport: true, available: true },
        { id: 3, role: 'button', label: '导出', viewport: true, available: true, region: 1 },
      ] },
    };
    expect((await app.inject({ method: 'POST', url, headers, payload: input })).statusCode).toBe(502);
    const result = await app.inject({ method: 'POST', url, headers, payload: { ...input, finishOnly: true } });
    expect(result.json().proofs).toEqual([{ index: 1, targetId: 3,
      checks: [{ id: 3, field: 'label', equals: '导出' }] }, proof]);
  });

  it('到达界面的条件不能用最终指引当作已完成', async () => {
    const app = service(async () => ({ kind: 'point', targetId: 1,
      requirements: [{ start: null, result: '详情界面已打开', source: 'arrival' }] }));
    const result = await app.inject({ method: 'POST', url, headers,
      payload: { ...payload, goal: '带我打开详情界面', requirements: [] } });
    expect(result.statusCode).toBe(502);
  });

  it('由分界切出完整原话，并保留已完成项的证明', async () => {
    const goal = '把字号调成大号，并把主题切换到深色。';
    const proofs = [{ index: 0, checks: [{ id: 1, field: 'checked', equals: true }] }];
    const app = service(async () => ({ kind: 'message', instruction: '再选择深色主题。', proofs, requirements: [
      { start: null, result: '字号已调大', source: 'page' },
      { start: '把主题切换到深色', result: '主题已切换到深色', source: 'page' },
    ] }));
    const result = await app.inject({ method: 'POST', url, headers, payload: { ...payload, goal, requirements: [] } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ proofs, requirements: [
      { quote: '把字号调成大号，并', source: 'page' },
      { quote: '把主题切换到深色。', source: 'page' },
    ] });
  });

  it('遇到重复分界时，保留普通指引并等待模型重新提炼条件', async () => {
    const app = service(async () => ({ kind: 'message', instruction: '选择可见范围。', requirements: [
      { start: null, result: '已发布', source: 'page' },
      { start: '确认', result: '可见范围已切换', source: 'page' },
    ] }));
    const result = await app.inject({ method: 'POST', url, headers, payload: {
      ...payload, goal: '确认已经发布，并确认可见范围只限团队。', requirements: [],
    } });
    expect(result.json()).toEqual({ kind: 'message', instruction: '选择可见范围。' });
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

  it('复查时允许把几项网页条件归并，并按新条件校验同条回复', async () => {
    const goal = '打开设置并确认同步已启用';
    const original = [
      { quote: '打开设置', result: '到达设置', source: 'page' },
      { quote: '并确认同步已启用', result: '同步已启用', source: 'page' },
    ];
    const decision = {
      kind: 'keep', requirements: [{ quote: goal, result: '设置中的同步已启用', source: 'page' }],
      proofs: [{ index: 0, checks: [{ id: 1, field: 'label', equals: '属性栏' }] }],
    };
    const app = service(async () => decision);
    const result = await app.inject({ method: 'POST', url, headers, payload: {
      ...payload, goal, requirements: original, reviewRequirements: true,
    } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual(decision);
  });

  it('含用户确认的目标不能通过网页条件复查重写', async () => {
    const app = service(vi.fn());
    const result = await app.inject({ method: 'POST', url, headers, payload: {
      ...payload, goal: '确认已导出且已下载到电脑', reviewRequirements: true,
      requirements: [
        { quote: '确认已导出', result: '已导出', source: 'page' },
        { quote: '且已下载到电脑', result: '已下载到电脑', source: 'user' },
      ],
    } });
    expect(result.statusCode).toBe(400);
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

  it.each([
    ['model-http', () => new Response('private body', { status: 429 }), { upstreamStatus: 429 }],
    ['model-connection', () => { throw new Error('private connection error'); }, {}],
    ['model-body', () => new Response('private invalid body'), {}],
    ['model-empty', () => Response.json({ choices: [{ message: { content: ' ' } }] }), {}],
    ['model-truncated', () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{' } }] }), {}],
    ['model-json', () => Response.json({ choices: [{ message: { content: 'private invalid JSON' } }] }), {}],
    ['decision-rejected', () => Response.json({ choices: [{ message: { content: '{"kind":"highlight","targetId":999,"instruction":"private instruction"}' } }] }), {}],
    ['ok', () => Response.json({ choices: [{ message: { content: '{"kind":"message","instruction":"查看属性栏。"}' } }] }), {}],
  ] as const)('记录引导诊断 %s，省略上下文和上游原文', async (outcome, response, detail) => {
    const report = vi.fn();
    const decide = createModelGuide({ url: 'https://model.example/v1/chat/completions', name: 'practice-model',
      key: 'private key' }, async () => response());
    const app = service(decide, [origin], report);
    const result = await app.inject({ method: 'POST', url, headers, payload });
    expect(result.statusCode).toBe(outcome === 'ok' ? 200 : 502);
    expect(report).toHaveBeenCalledExactlyOnceWith({ outcome, elapsedMs: expect.any(Number), ...detail });
    expect(result.body).not.toContain('private');
  });

  it('即使上游仍在等待，也会按时结束请求', async () => {
    const timeout = new AbortController();
    const deadline = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(timeout.signal);
    const report = vi.fn();
    const app = service(async () => {
      queueMicrotask(() => timeout.abort());
      return await new Promise(() => {});
    }, [origin], report);
    try {
      const result = await app.inject({ method: 'POST', url, headers, payload });
      expect(result.statusCode).toBe(504);
      expect(deadline).toHaveBeenCalledWith(18_000);
      expect(result.json()).toEqual({ error: expect.any(String) });
      expect(report).toHaveBeenCalledExactlyOnceWith({ outcome: 'service-deadline', elapsedMs: expect.any(Number) });
    } finally {
      deadline.mockRestore();
    }
  }, 1500);

  it('浏览器取消请求后中止上游判断', async () => {
    const onAbort = vi.fn();
    const report = vi.fn();
    const app = service(async (_input, signal) => {
      await new Promise<void>(resolve => {
        signal.addEventListener('abort', () => {
          onAbort();
          resolve();
        }, { once: true });
      });
    }, [origin], report);
    app.addHook('preHandler', async (_request, reply) => {
      // 模拟请求体已经被读取、模型仍在等待时关闭浏览器连接。
      setImmediate(() => reply.raw.destroy());
    });
    await expect(app.inject({ method: 'POST', url, headers, payload }))
      .rejects.toMatchObject({ code: 'LIGHT_ECONNRESET' });
    expect(onAbort).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledExactlyOnceWith({ outcome: 'client-disconnected', elapsedMs: expect.any(Number) });
  });
});
