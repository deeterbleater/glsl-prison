import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './context.js';

export async function registerModelRoutes(
  app: FastifyInstance,
  context: RouteContext,
): Promise<void> {
  app.get('/models', async () => context.modelCatalog.listModels());
}
