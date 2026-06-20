import type { GenerateRequest } from '@shader-oracle/shared';
import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './context.js';
import { sanitizeFragmentShader } from '../services/shaderSanitizer.js';

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
    const mode = body?.mode ?? 'fragment';
    const requestedModel = body?.model?.trim();
    const model =
      !requestedModel || requestedModel === 'default'
        ? context.modelClient.defaultModel
        : requestedModel;
    const charLimit = charLimitFromRequest(body);

    if (!prompt) {
      return reply.code(400).send({ ok: false, error: 'prompt is required' });
    }
    if (mode !== 'fragment' && mode !== 'body') {
      return reply.code(400).send({ ok: false, error: 'only fragment mode is supported' });
    }

    const raw = await context.modelClient.generateShader({ prompt, model, charLimit });
    const sanitized = sanitizeFragmentShader(raw, { charLimit });
    if (!sanitized.ok) {
      return reply.code(422).send({ ok: false, error: sanitized.reason });
    }

    const { attempt } = await context.repository.createRunWithAttempt({
      prompt,
      fragment: sanitized.cleaned,
      mode: 'fragment',
      model,
    });

    return {
      runId: attempt.runId,
      attemptId: attempt.id,
      fragment: sanitized.cleaned,
      mode: 'fragment',
      model,
      status: 'generated',
    };
  });
}
