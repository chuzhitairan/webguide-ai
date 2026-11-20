import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { addNavigationRoutes } from './navigation.js';
import type { NavigationService } from './navigation.js';

// Keep route setup separate from listening so tests can send a request in memory.
export function createApp(navigation?: NavigationService): FastifyInstance {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  app.get('/health', async () => ({ status: 'ok', ai: navigation ? 'enabled' : 'disabled' }));
  addNavigationRoutes(app, navigation);
  return app;
}
