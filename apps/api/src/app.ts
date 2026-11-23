import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isExtensionOrigin } from './config.js';
import { isGuideRequest } from './guide-protocol.js';
import { ModelRequestError, validateDecision } from './guide.js';
import type { GuideService, ModelFailure } from './guide.js';

const guidePath = '/api/v1/guide';
const guideTimeoutMs = 12_000;

type GuideOutcome = ModelFailure
  | { outcome: 'ok' | 'decision-rejected' | 'client-disconnected' | 'service-deadline' | 'service-error' };
type GuideDiagnostic = GuideOutcome & { elapsedMs: number };

function allowOrigin(request: FastifyRequest, reply: FastifyReply, service: GuideService): boolean {
  const { host, origin } = request.headers;
  if (!/^(127\.0\.0\.1|localhost)(?::\d{1,5})?$/i.test(host ?? '') || !isExtensionOrigin(origin)
    || (service.origins.length > 0 && !service.origins.includes(origin))) return false;
  reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
  return true;
}

function hasToken(authorization: string | undefined, token: string): boolean {
  if (!token || !authorization) return false;
  const received = Buffer.from(authorization);
  const expected = Buffer.from('Bearer ' + token);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// 将建服务和监听端口分开，测试可以直接向服务发请求。
export function createApp(service?: GuideService, report?: (diagnostic: GuideDiagnostic) => void): FastifyInstance {
  const app = Fastify();
  app.get('/health', async () => ({ status: 'ok' }));

  app.options(guidePath, (request, reply) => {
    if (!service || !allowOrigin(request, reply, service)) {
      return reply.code(403).send({ error: '本机服务未允许此扩展来源。' });
    }
    return reply.header('Access-Control-Allow-Methods', 'POST')
      .header('Access-Control-Allow-Headers', 'Content-Type, Authorization').code(204).send();
  });

  app.post(guidePath, {
    bodyLimit: 96 * 1024,
    onRequest: async (request, reply) => {
      if (!service) return reply.code(503).send({ error: '本机服务还没有配置导航模型和访问令牌。' });
      if (!allowOrigin(request, reply, service)) {
        return reply.code(403).send({ error: '本机服务未允许此扩展来源。' });
      }
      if (!hasToken(request.headers.authorization, service.token)) {
        return reply.code(401).send({ error: '本机访问令牌不正确。' });
      }
    },
    errorHandler: (error, _request, reply) => {
      const status = error.statusCode ?? 500;
      const message = status === 413 ? '引导请求超过大小上限。'
        : status < 500 ? '引导请求格式不正确。' : '本机服务处理引导请求失败。';
      return reply.code(status).send({ error: message });
    },
  }, async (request, reply) => {
    if (!service) return reply.code(503).send({ error: '本机服务还没有配置导航模型和访问令牌。' });
    if (!isGuideRequest(request.body)) return reply.code(400).send({ error: '引导请求中的证据格式不正确。' });

    const disconnect = new AbortController();
    const abort = () => disconnect.abort();
    // 请求体已读完后浏览器仍可能取消等待。监听响应关闭以中止上游。
    reply.raw.once('close', abort);
    const deadline = AbortSignal.timeout(guideTimeoutMs);
    const signal = AbortSignal.any([disconnect.signal, deadline]);
    const started = performance.now();
    const record = (outcome: GuideOutcome) => report?.({ ...outcome, elapsedMs: Math.round(performance.now() - started) });
    let onAbort: (() => void) | undefined;
    try {
      if (reply.raw.destroyed) disconnect.abort();
      signal.throwIfAborted();
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
      });
      const result = await Promise.race([service.decide(request.body, signal), cancelled]);
      signal.throwIfAborted();
      const decision = validateDecision(result, request.body);
      if (decision) {
        record({ outcome: 'ok' });
        return decision;
      }
      record({ outcome: 'decision-rejected' });
      return reply.code(502).send({ error: '模型没有返回可用的引导决定，请重试。' });
    } catch (error) {
      if (disconnect.signal.aborted) {
        record({ outcome: 'client-disconnected' });
        return reply.hijack();
      }
      if (deadline.aborted) {
        record({ outcome: 'service-deadline' });
        return reply.code(504).send({ error: '模型判断超时，请重试。' });
      }
      const failure = error instanceof ModelRequestError ? error.failure : { outcome: 'service-error' as const };
      record(failure);
      if (failure.outcome === 'model-empty' || failure.outcome === 'model-json' || failure.outcome === 'model-truncated') {
        return reply.code(502).send({ error: '模型没有返回可用的引导决定，请重试。' });
      }
      return reply.code(502).send({ error: '本机服务暂时无法调用模型，请重试。' });
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
      reply.raw.off('close', abort);
    }
  });

  return app;
}
