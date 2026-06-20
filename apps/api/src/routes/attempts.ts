import type { CaptureRequest, CompileResultRequest, RepairRequest } from '@shader-oracle/shared';
import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './context.js';
import { canAccessOwner } from './auth.js';
import { repairOnce } from '../services/repairLoop.js';

const MAX_CAPTURE_FRAMES = 3;
const MAX_CAPTURE_DATA_URL_LENGTH = 1_200_000;

function cleanDataUrl(dataUrl: string): string | undefined {
  const trimmed = dataUrl.trim();
  if (!trimmed.startsWith('data:image/png;base64,')) return undefined;
  if (trimmed.length > MAX_CAPTURE_DATA_URL_LENGTH) return undefined;
  return trimmed;
}

export async function registerAttemptRoutes(
  app: FastifyInstance,
  context: RouteContext,
): Promise<void> {
  app.post<{ Params: { attemptId: string }; Body: CompileResultRequest }>(
    '/attempts/:attemptId/compile-result',
    async (request, reply) => {
      const attempt = await context.repository.getAttempt(request.params.attemptId);
      if (!attempt) return reply.code(404).send({ ok: false, error: 'attempt not found' });
      if (!canAccessOwner(context, request, reply, attempt.run.userId)) return;

      const body = request.body;
      if (typeof body?.ok !== 'boolean' || typeof body.compileLog !== 'string') {
        return reply.code(400).send({ ok: false, error: 'invalid compile result' });
      }
      if (body.ok && !body.stats) {
        return reply.code(400).send({ ok: false, error: 'stats are required on compile success' });
      }

      await context.repository.updateCompileResult(request.params.attemptId, body);
      return { ok: true };
    },
  );

  app.post<{ Params: { attemptId: string }; Body: RepairRequest }>(
    '/attempts/:attemptId/repair',
    async (request, reply) => {
      const previous = await context.repository.getAttempt(request.params.attemptId);
      if (!previous) return reply.code(404).send({ ok: false, error: 'attempt not found' });
      if (!canAccessOwner(context, request, reply, previous.run.userId)) return;

      const compileLog = request.body?.compileLog?.trim() || previous.compileLog || '';
      const fragment = request.body?.fragment?.trim() || previous.fragment;
      const reasoningEffort = request.body?.reasoningEffort;
      const model = previous.model || previous.run.model || context.modelClient.defaultModel;
      let repaired;
      try {
        repaired = await repairOnce({
          modelClient: context.modelClient,
          prompt: previous.run.prompt,
          fragment,
          compileLog,
          model,
          charLimit: 8000,
          reasoningEffort,
        });
      } catch (error) {
        return reply.code(422).send({
          ok: false,
          error: error instanceof Error ? error.message : 'shader repair failed verification',
        });
      }

      const attempt = await context.repository.createAttempt({
        runId: previous.runId,
        fragment: repaired,
        mode: 'fragment',
        model,
      });

      return {
        runId: attempt.runId,
        attemptId: attempt.id,
        fragment: repaired,
        mode: 'fragment',
        model,
        status: 'generated',
      };
    },
  );

  app.post<{ Params: { attemptId: string }; Body: CaptureRequest }>(
    '/attempts/:attemptId/capture',
    async (request, reply) => {
      const attempt = await context.repository.getAttempt(request.params.attemptId);
      if (!attempt) return reply.code(404).send({ ok: false, error: 'attempt not found' });
      if (!canAccessOwner(context, request, reply, attempt.run.userId)) return;

      const frames = Array.isArray(request.body?.frames) ? request.body.frames : [];
      const cleaned = frames
        .slice(0, MAX_CAPTURE_FRAMES)
        .map((frame) => ({ t: Number(frame.t), dataUrl: cleanDataUrl(frame.dataUrl) }))
        .filter((frame): frame is { t: number; dataUrl: string } => {
          return Number.isFinite(frame.t) && Boolean(frame.dataUrl);
        });

      if (cleaned.length === 0) {
        return reply
          .code(400)
          .send({ ok: false, error: 'at least one png dataUrl frame is required' });
      }

      await context.repository.addCaptures(request.params.attemptId, cleaned);
      return { ok: true };
    },
  );
}
