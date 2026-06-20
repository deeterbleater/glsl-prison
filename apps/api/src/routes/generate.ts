import type { GenerateRequest } from '@shader-oracle/shared';
import type { FastifyInstance } from 'fastify';
import type { OpenRouterModelDto } from '@shader-oracle/shared';
import { InsufficientTokensError } from '../db/repository.js';
import {
  estimatedPaidGenerationCharge,
  modelHasBillablePricing,
  modelIsPaid,
  usageChargeForPricing,
} from '../services/billing.js';
import type { RouteContext } from './context.js';
import { requireUserId } from './auth.js';
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

async function getPaidModelForBilling(
  context: RouteContext,
  model: string,
): Promise<{ model?: OpenRouterModelDto; paid: boolean }> {
  if (context.modelClient.providerName !== 'openrouter') return { paid: false };
  const catalogModel = await context.modelCatalog.getModel(model);
  return { model: catalogModel, paid: modelIsPaid(catalogModel, model) };
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

    const userId = requireUserId(context, request, reply);
    if (context.auth.required && !userId) return;

    const billingModel = await getPaidModelForBilling(context, model);
    if (billingModel.paid) {
      if (!userId) return reply.code(401).send({ ok: false, error: 'sign in required' });
      if (!modelHasBillablePricing(billingModel.model)) {
        return reply.code(503).send({ ok: false, error: 'model pricing is unavailable' });
      }

      const pricing = billingModel.model?.pricing;
      if (!pricing)
        return reply.code(503).send({ ok: false, error: 'model pricing is unavailable' });

      const balance = await context.repository.getTokenBalance(userId);
      const estimatedCharge = estimatedPaidGenerationCharge({
        pricing,
        promptText: prompt,
        charLimit,
        maxCalls: maxRepairAttempts + 1,
      });
      if (balance.balanceTokens < estimatedCharge) {
        return reply.code(402).send({
          ok: false,
          error: `paid model requires ${estimatedCharge} glsl.chat tokens for this generation`,
          balanceTokens: balance.balanceTokens,
          requiredTokens: estimatedCharge,
        });
      }
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
      userId,
      prompt,
      fragment: verified.fragment,
      mode: 'fragment',
      model,
    });

    let billing;
    if (billingModel.paid && userId && billingModel.model?.pricing) {
      const charge = usageChargeForPricing(billingModel.model.pricing, verified.usages);
      const chargedTokens = Math.max(1, charge.chargedTokens);
      try {
        const balance = await context.repository.debitTokenUsage({
          userId,
          tokenCost: chargedTokens,
          type: 'usage_generate',
          model,
          runId: attempt.runId,
          attemptId: attempt.id,
          promptTokens: charge.promptTokens,
          completionTokens: charge.completionTokens,
          totalTokens: charge.totalTokens,
          costUsdMicros: charge.costUsdMicros,
          description: `Paid shader generation with ${model}`,
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
      fragment: verified.fragment,
      mode: 'fragment',
      model,
      status: 'generated',
      billing,
    };
  });
}
