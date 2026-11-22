import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// 将建服务和监听端口分开，测试可以直接向服务发请求。
export function createApp(): FastifyInstance {
  const app = Fastify();
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
