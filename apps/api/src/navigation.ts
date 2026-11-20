import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface NavigationInput {
  goal: string;
  page: {
    path: string;
    title: string;
    controls: { id: number; label: string; role: string; region?: string; path?: string }[];
  };
}

export interface NavigationService {
  choose(input: NavigationInput): Promise<unknown>;
  clientToken: string;
  origins: string[];
}

const path = { type: 'string', maxLength: 300, pattern: '^/(?!/)[^?#]*$' };
const body = {
  type: 'object', additionalProperties: false, required: ['goal', 'page'],
  properties: {
    goal: { type: 'string', minLength: 1, maxLength: 200 },
    page: {
      type: 'object', additionalProperties: false, required: ['path', 'title', 'controls'],
      properties: {
        path,
        title: { type: 'string', maxLength: 160 },
        controls: {
          type: 'array', maxItems: 140,
          items: {
            type: 'object', additionalProperties: false, required: ['id', 'label', 'role'],
            properties: {
              id: { type: 'integer', minimum: 1, maximum: 140 },
              label: { type: 'string', minLength: 1, maxLength: 120 },
              role: { type: 'string', minLength: 1, maxLength: 24 },
              region: { type: 'string', maxLength: 32 },
              path,
            },
          },
        },
      },
    },
  },
};

function allowedHost(request: FastifyRequest): boolean {
  return /^127\.0\.0\.1(?::\d{1,5})?$/.test(request.headers.host ?? '');
}

function authorized(header: string | undefined, token: string): boolean {
  const received = Buffer.from(header ?? '');
  const expected = Buffer.from('Bearer ' + token);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function allowOrigin(reply: FastifyReply, origin: string) {
  reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
}

function readDecision(raw: unknown, input: NavigationInput) {
  if (!raw || typeof raw !== 'object' || !('instruction' in raw) || typeof raw.instruction !== 'string' || !('kind' in raw)) return;
  const instruction = raw.instruction.trim();
  if (!instruction || instruction.length > 240) return;
  if (raw.kind === 'message') return { kind: 'message', instruction };
  if (raw.kind === 'highlight' && 'targetId' in raw && typeof raw.targetId === 'number'
    && input.page.controls.some(control => control.id === raw.targetId)) {
    return { kind: 'highlight', targetId: raw.targetId, instruction };
  }
}

export function addNavigationRoutes(app: FastifyInstance, service?: NavigationService) {
  const url = '/api/v1/navigate';

  app.options(url, (request, reply) => {
    const origin = request.headers.origin;
    if (!allowedHost(request) || !origin || !service?.origins.includes(origin)) {
      return reply.code(403).send({ error: '本机服务未允许此扩展来源。' });
    }
    allowOrigin(reply, origin);
    return reply.header('Access-Control-Allow-Methods', 'POST')
      .header('Access-Control-Allow-Headers', 'Content-Type, Authorization').code(204).send();
  });

  app.post<{ Body: NavigationInput }>(url, {
    schema: { body },
    bodyLimit: 96 * 1024,
    onRequest: async (request, reply) => {
      const origin = request.headers.origin;
      if (!allowedHost(request)) return reply.code(403).send({ error: '请使用本机回环地址连接。' });
      if (!service) return reply.code(503).send({ error: '本机服务还没有配置导航模型和访问令牌。' });
      if (origin) {
        if (!service.origins.includes(origin)) return reply.code(403).send({ error: '本机服务未允许此扩展来源。' });
        allowOrigin(reply, origin);
      }
      if (!authorized(request.headers.authorization, service.clientToken)) {
        return reply.code(401).send({ error: '本机访问令牌不正确。' });
      }
    },
  }, async (request, reply) => {
    if (!service) return reply.code(503).send();
    try {
      // 模型只能从这次快照里挑编号。任何额外属性都不会发回扩展。
      const action = readDecision(await service.choose(request.body), request.body);
      if (action) return action;
      return reply.code(502).send({ error: '模型没有返回可用的导航建议，请重试。' });
    } catch {
      return reply.code(502).send({ error: '本机服务暂时无法调用模型，请重试。' });
    }
  });
}
