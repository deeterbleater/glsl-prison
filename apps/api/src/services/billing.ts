import type { OpenRouterModelDto, OpenRouterModelPricing } from '@shader-oracle/shared';
import {
  estimateOpenRouterUsageUsdMicros,
  glslTokensForOpenRouterUsage,
  openRouterPricingIsFree,
  usdMicrosToGlslTokens,
} from '@shader-oracle/shared';
import type { ModelUsage } from './modelClient.js';

export type UsageCharge = {
  chargedTokens: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsdMicros?: number;
};

function positiveInt(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function sumOptional(values: Array<number | undefined>): number | undefined {
  const numbers = values.map(positiveInt).filter((value): value is number => value !== undefined);
  if (numbers.length === 0) return undefined;
  return numbers.reduce((total, value) => total + value, 0);
}

export function modelIsPaid(model: OpenRouterModelDto | undefined, modelId: string): boolean {
  if (model?.glslTokenPricing) return model.glslTokenPricing.paid;
  return !openRouterPricingIsFree(model?.pricing, modelId);
}

export function modelHasBillablePricing(model: OpenRouterModelDto | undefined): boolean {
  if (!model) return false;
  if (!modelIsPaid(model, model.id)) return true;
  return Boolean(model.pricing?.prompt || model.pricing?.completion || model.pricing?.request);
}

export function usageChargeForPricing(
  pricing: OpenRouterModelPricing,
  usages: ModelUsage[],
): UsageCharge {
  const promptTokens = sumOptional(usages.map((usage) => usage.promptTokens));
  const completionTokens = sumOptional(usages.map((usage) => usage.completionTokens));
  const totalTokens = sumOptional(usages.map((usage) => usage.totalTokens));
  const costUsdMicros = estimateOpenRouterUsageUsdMicros({
    pricing,
    promptTokens,
    completionTokens,
    requestCount: usages.length || 1,
  });
  const chargedTokens = glslTokensForOpenRouterUsage({
    pricing,
    promptTokens,
    completionTokens,
    requestCount: usages.length || 1,
  });

  return {
    chargedTokens,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsdMicros,
  };
}

export function estimatedPaidGenerationCharge(input: {
  pricing: OpenRouterModelPricing;
  promptText: string;
  charLimit: number;
  maxCalls: number;
}): number {
  const maxCalls = Math.max(1, Math.floor(input.maxCalls));
  const promptTokens = Math.ceil((input.promptText.length + 5000) / 4) * maxCalls;
  const completionTokens =
    Math.max(600, Math.min(6000, Math.ceil(input.charLimit / 1.3))) * maxCalls;
  const costUsdMicros = estimateOpenRouterUsageUsdMicros({
    pricing: input.pricing,
    promptTokens,
    completionTokens,
    requestCount: maxCalls,
  });
  return Math.max(1, usdMicrosToGlslTokens(costUsdMicros));
}
