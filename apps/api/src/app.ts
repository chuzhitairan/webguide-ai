import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Keep route setup separate from listening so tests can send a request in memory.
export function createApp(): FastifyInstance {
  const app = Fastify();
  app.get('/health', async () => ({ status: 'ok', ai: 'disabled' }));
  return app;
}