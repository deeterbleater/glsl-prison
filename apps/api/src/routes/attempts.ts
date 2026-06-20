import type { CaptureRequest, CompileResultRequest, RepairRequest } from '@shader-oracle/shared';
import type { OpenRouterModelDto } from '@shader-oracle/shared';
import type { FastifyInstance } from 'fastify';
import { InsufficientTokensError } from '../db/repository.js';
import {
  estimatedPaidGenerationCharge,
  modelHasBillablePricing,
  modelIsPaid,
  usageChargeForPricing,
} from '../services/billing.js';
import type { RouteContext } from './context.js';
import { canAccessOwner, requestUserId } from './auth.js';
import { repairOnce } from '../services/repairLoop.js';

const MAX_CAPTURE_FRAMES = 3;
const MAX_CAPTURE_DATA_URL_LENGTH = 1_200_000;

function cleanDataUrl(dataUrl: string): string | undefined {
  const trimmed = dataUrl.trim();
  if (!trimmed.startsWith('data:image/png;base64,')) return undefined;
  if (trimmed.length > MAX_CAPTURE_DATA_URL_LENGTH) return undefined;
  return trimmed;
}

async function getPaidModelForBilling(
  context: RouteContext,
  model: string,
): Promise<{ model?: OpenRouterModelDto; paid: boolean }> {
  if (context.modelClient.providerName !== 'openrouter') return { paid: false };
  const catalogModel = await context.modelCatalog.getModel(model);
  return { model: catalogModel, paid: modelIsPaid(catalogModel, model) };
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
      const userId = requestUserId(context, request);
      const billingModel = await getPaidModelForBilling(context, model);
      if (billingModel.paid) {
        if (!userId) return reply.code(401).send({ ok: false, error: 'sign in required' });
        if (!modelHasBillablePricing(billingModel.model)) {
          return reply.code(503).send({ ok: false, error: 'model pricing is unavailable' });
        }

        const pricing = billingModel.model?.pricing;
        if (!pricing) {
          return reply.code(503).send({ ok: false, error: 'model pricing is unavailable' });
        }

        const balance = await context.repository.getTokenBalance(userId);
        const estimatedCharge = estimatedPaidGenerationCharge({
          pricing,
          promptText: `${previous.run.prompt}\n${fragment}\n${compileLog}`,
          charLimit: 8000,
          maxCalls: 3,
        });
        if (balance.balanceTokens < estimatedCharge) {
          return reply.code(402).send({
            ok: false,
            error: `paid model requires ${estimatedCharge} glsl.chat tokens for this repair`,
            balanceTokens: balance.balanceTokens,
            requiredTokens: estimatedCharge,
          });
        }
      }

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
        fragment: repaired.fragment,
        mode: 'fragment',
        model,
      });

      let billing;
      if (billingModel.paid && userId && billingModel.model?.pricing) {
        const charge = usageChargeForPricing(billingModel.model.pricing, repaired.usages);
        const chargedTokens = Math.max(1, charge.chargedTokens);
        try {
          const balance = await context.repository.debitTokenUsage({
            userId,
            tokenCost: chargedTokens,
            type: 'usage_repair',
            model,
            runId: attempt.runId,
            attemptId: attempt.id,
            promptTokens: charge.promptTokens,
            completionTokens: charge.completionTokens,
            totalTokens: charge.totalTokens,
            costUsdMicros: charge.costUsdMicros,
            description: `Paid shader repair with ${model}`,
          });
          billing = { ...charge, chargedTokens, balanceTokens: balance.balanceTokens };
        } catch (error) {
          if (error instanceof InsufficientTokensError) {
            return reply.code(402).send({
              ok: false,
              error: 'not enough glsl.chat tokens',
              balanceTokens: error.balanceTokens,
              requiredTokens: error.requiredTokens,
            });
          }
          throw error;
        }
      }

      return {
        runId: attempt.runId,
        attemptId: attempt.id,
        fragment: repaired.fragment,
        mode: 'fragment',
        model,
        status: 'generated',
        billing,
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
