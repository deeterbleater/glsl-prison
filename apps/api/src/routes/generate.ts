import type { GenerateRequest } from '@shader-oracle/shared';
import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './context.js';
import { generateWithVerification } from '../services/repairLoop.js';

function charLimitFromRequest(body: GenerateRequest): number {
  const requested = body.constraints?.charLimit;
  if (!requested || !Number.isFinite(requested)) return 8000;
  return Math.max(1000, Math.min(12000, Math.floor(requested)));
}

function repairAttemptsFromRequest(body: GenerateRequest): number {
  const requested = body.constraints?.maxRepairAttempts;
  if (!requested || !Number.isFinite(requested)) return 3;
  return Math.max(1, Math.min(5, Math.floor(requested)));
}

function generationErrorStatus(error: unknown): number {
  if (!(error instanceof Error)) return 422;
  return /API error|token limit|configured/i.test(error.message) ? 502 : 422;
}

export async function registerGenerateRoutes(
  app: FastifyInstance,
  context: RouteContext,
): Promise<void> {
  app.post<{ Body: GenerateRequest }>('/generate', async (request, reply) => {
    const body = request.body;
    const prompt = body?.prompt?.trim();
    const mode = body?.mode ?? 'fragment';
    const requestedModel = body?.model?.trim();
    const model =
      !requestedModel || requestedModel === 'default'
        ? context.modelClient.defaultModel
        : requestedModel;
    const charLimit = charLimitFromRequest(body);
    const maxRepairAttempts = repairAttemptsFromRequest(body);
    const reasoningEffort = body.constraints?.reasoningEffort;

    if (!prompt) {
      return reply.code(400).send({ ok: false, error: 'prompt is required' });
    }
    if (mode !== 'fragment' && mode !== 'body') {
      return reply.code(400).send({ ok: false, error: 'only fragment mode is supported' });
    }

    let verified;
    try {
      verified = await generateWithVerification({
        modelClient: context.modelClient,
        prompt,
        model,
        charLimit,
        maxRepairAttempts,
        reasoningEffort,
      });
    } catch (error) {
      return reply.code(generationErrorStatus(error)).send({
        ok: false,
        error: error instanceof Error ? error.message : 'shader verification failed',
      });
    }

    const { attempt } = await context.repository.createRunWithAttempt({
      prompt,
      fragment: verified.fragment,
      mode: 'fragment',
      model,
    });

    return {
      runId: attempt.runId,
      attemptId: attempt.id,
      fragment: verified.fragment,
      mode: 'fragment',
      model,
      status: 'generated',
    };
  });
}
