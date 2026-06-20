import type { PublishRequest } from '@shader-oracle/shared';
import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './context.js';

export async function registerRunRoutes(
  app: FastifyInstance,
  context: RouteContext,
): Promise<void> {
  app.get<{ Params: { runId: string } }>('/runs/:runId', async (request, reply) => {
    const run = await context.repository.getRun(request.params.runId);
    if (!run) return reply.code(404).send({ ok: false, error: 'run not found' });
    return run;
  });

  app.post<{ Params: { runId: string }; Body: PublishRequest }>(
    '/runs/:runId/publish',
    async (request, reply) => {
      const isPublic = Boolean(request.body?.public);
      const run = await context.repository.publishRun(request.params.runId, isPublic);
      if (!run) return reply.code(404).send({ ok: false, error: 'run not found' });

      return {
        ok: true,
        shareUrl: `${context.env.publicWebBaseUrl.replace(/\/$/, '')}/r/${run.id}`,
      };
    },
  );
}
