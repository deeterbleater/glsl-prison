import type { OpenRouterModelPricing } from './apiContracts.js';

export const GLSL_CHAT_PURCHASE_TOKENS = 1000;
export const GLSL_CHAT_PURCHASE_USD_CENTS = 1000;
export const GLSL_CHAT_SURCHARGE_RATE = 0.05;
export const GLSL_CHAT_TOKENS_PER_USD =
  (GLSL_CHAT_PURCHASE_TOKENS / GLSL_CHAT_PURCHASE_USD_CENTS) * 100;

export type GlslTokenPricing = {
  paid: boolean;
  surchargeRate: number;
  promptPerMillion?: number;
  completionPerMillion?: number;
  request?: number;
  image?: number;
};

export type OpenRouterUsagePricingInput = {
  pricing?: OpenRouterModelPricing;
  promptTokens?: number;
  completionTokens?: number;
  requestCount?: number;
};

function parseUsdPrice(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function roundCharge(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value);
}

export function usdToGlslTokens(usd: number): number {
  return roundCharge(usd * GLSL_CHAT_TOKENS_PER_USD * (1 + GLSL_CHAT_SURCHARGE_RATE));
}

export function usdMicrosToGlslTokens(usdMicros: number): number {
  return usdToGlslTokens(usdMicros / 1_000_000);
}

export function pricePerTokenToGlslTokensPerMillion(price: string | undefined): number | undefined {
  const usdPerToken = parseUsdPrice(price);
  if (usdPerToken === undefined) return undefined;
  return roundCharge(
    usdPerToken * 1_000_000 * GLSL_CHAT_TOKENS_PER_USD * (1 + GLSL_CHAT_SURCHARGE_RATE),
  );
}

export function fixedUsdPriceToGlslTokens(price: string | undefined): number | undefined {
  const usd = parseUsdPrice(price);
  if (usd === undefined) return undefined;
  return usdToGlslTokens(usd);
}

export function openRouterPricingIsFree(
  pricing: OpenRouterModelPricing | undefined,
  modelId?: string,
): boolean {
  if (modelId?.endsWith(':free')) return true;
  if (!pricing) return false;

  const prices = [pricing.prompt, pricing.completion, pricing.request, pricing.image]
    .map(parseUsdPrice)
    .filter((price): price is number => price !== undefined);

  return prices.length > 0 && prices.every((price) => price === 0);
}

export function glslTokenPricingForOpenRouterModel(
  pricing: OpenRouterModelPricing | undefined,
  modelId?: string,
): GlslTokenPricing {
  return {
    paid: !openRouterPricingIsFree(pricing, modelId),
    surchargeRate: GLSL_CHAT_SURCHARGE_RATE,
    promptPerMillion: pricePerTokenToGlslTokensPerMillion(pricing?.prompt),
    completionPerMillion: pricePerTokenToGlslTokensPerMillion(pricing?.completion),
    request: fixedUsdPriceToGlslTokens(pricing?.request),
    image: fixedUsdPriceToGlslTokens(pricing?.image),
  };
}

export function estimateOpenRouterUsageUsdMicros(input: OpenRouterUsagePricingInput): number {
  const prompt = parseUsdPrice(input.pricing?.prompt) ?? 0;
  const completion = parseUsdPrice(input.pricing?.completion) ?? 0;
  const request = parseUsdPrice(input.pricing?.request) ?? 0;
  const promptTokens = Math.max(0, Math.floor(input.promptTokens ?? 0));
  const completionTokens = Math.max(0, Math.floor(input.completionTokens ?? 0));
  const requestCount = Math.max(0, Math.floor(input.requestCount ?? 1));
  const usd = promptTokens * prompt + completionTokens * completion + requestCount * request;
  return Math.ceil(usd * 1_000_000);
}

export function glslTokensForOpenRouterUsage(input: OpenRouterUsagePricingInput): number {
  return usdMicrosToGlslTokens(estimateOpenRouterUsageUsdMicros(input));
}
