import type { JudgeRequest } from '@shader-oracle/shared';
import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './context.js';

export async function registerJudgeRoutes(
  app: FastifyInstance,
  context: RouteContext,
): Promise<void> {
  app.post<{ Params: { attemptId: string }; Body: JudgeRequest }>(
    '/attempts/:attemptId/judge',
    async (request, reply) => {
      const attempt = await context.repository.getAttempt(request.params.attemptId);
      if (!attempt) return reply.code(404).send({ ok: false, error: 'attempt not found' });

      const captures = await context.repository.listCaptures(attempt.id);
      const result = await context.modelClient.judgeAttempt({
        prompt: attempt.run.prompt,
        fragment: attempt.fragment,
        stats: attempt.stats,
        captures: captures
          .filter((capture) => capture.dataUrl)
          .map((capture) => ({ t: capture.t, dataUrl: capture.dataUrl ?? '' })),
        model:
          !request.body?.judgeModel?.trim() || request.body.judgeModel.trim() === 'default'
            ? context.modelClient.defaultModel
            : request.body.judgeModel.trim(),
      });

      await context.repository.saveJudgeResult(attempt.id, result.score, result.critique);
      return {
        attemptId: attempt.id,
        score: result.score,
        critique: result.critique,
      };
    },
  );
}
