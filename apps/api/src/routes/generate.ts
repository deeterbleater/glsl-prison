import type { GenerateRequest } from '@shader-oracle/shared';
import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './context.js';
import { sanitizeShaderBody } from '../services/shaderSanitizer.js';

function charLimitFromRequest(body: GenerateRequest): number {
  const requested = body.constraints?.charLimit;
  if (!requested || !Number.isFinite(requested)) return 4000;
  return Math.max(1, Math.min(4000, Math.floor(requested)));
}

export async function registerGenerateRoutes(
  app: FastifyInstance,
  context: RouteContext,
): Promise<void> {
  app.post<{ Body: GenerateRequest }>('/generate', async (request, reply) => {
    const body = request.body;
    const prompt = body?.prompt?.trim();
    const mode = body?.mode ?? 'body';
    const requestedModel = body?.model?.trim();
    const model =
      !requestedModel || requestedModel === 'default'
        ? context.modelClient.defaultModel
        : requestedModel;
    const charLimit = charLimitFromRequest(body);

    if (!prompt) {
      return reply.code(400).send({ ok: false, error: 'prompt is required' });
    }
    if (mode !== 'body') {
      return reply.code(400).send({ ok: false, error: 'only body mode is supported in MVP' });
    }

    const raw = await context.modelClient.generateShader({ prompt, model, charLimit });
    const sanitized = sanitizeShaderBody(raw, { charLimit });
    if (!sanitized.ok) {
      return reply.code(422).send({ ok: false, error: sanitized.reason });
    }

    const { attempt } = await context.repository.createRunWithAttempt({
      prompt,
      fragment: sanitized.cleaned,
      mode: 'body',
      model,
    });

    return {
      runId: attempt.runId,
      attemptId: attempt.id,
      fragment: sanitized.cleaned,
      mode: 'body',
      model,
      status: 'generated',
    };
  });
}
