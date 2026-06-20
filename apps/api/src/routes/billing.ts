import type { BillingBalanceResponse, BillingCheckoutResponse } from '@shader-oracle/shared';
import {
  GLSL_CHAT_PURCHASE_TOKENS,
  GLSL_CHAT_PURCHASE_USD_CENTS,
  GLSL_CHAT_SURCHARGE_RATE,
} from '@shader-oracle/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RouteContext } from './context.js';
import { requestUserId } from './auth.js';

function requireBillingUser(
  context: RouteContext,
  request: FastifyRequest,
  reply: FastifyReply,
): string | undefined {
  const userId = requestUserId(context, request);
  if (userId) return userId;
  reply.code(401).send({ ok: false, error: 'sign in required' });
  return undefined;
}

function purchaseUrl(baseUrl: string | undefined, userId: string): string | undefined {
  if (!baseUrl) return undefined;
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('client_reference_id', userId);
    return url.toString();
  } catch {
    return undefined;
  }
}

function balanceResponse(
  context: RouteContext,
  userId: string,
  balanceTokens: number,
): BillingBalanceResponse {
  return {
    userId,
    balanceTokens,
    purchaseUrl: purchaseUrl(context.env.stripePaymentLinkUrl, userId),
    purchaseTokens: GLSL_CHAT_PURCHASE_TOKENS,
    purchaseUsdCents: GLSL_CHAT_PURCHASE_USD_CENTS,
    surchargeRate: GLSL_CHAT_SURCHARGE_RATE,
  };
}

export async function registerBillingRoutes(
  app: FastifyInstance,
  context: RouteContext,
): Promise<void> {
  app.get('/billing/balance', async (request, reply): Promise<BillingBalanceResponse | void> => {
    const userId = requireBillingUser(context, request, reply);
    if (!userId) return;
    const balance = await context.repository.getTokenBalance(userId);
    return balanceResponse(context, userId, balance.balanceTokens);
  });

  app.post('/billing/checkout', async (request, reply): Promise<BillingCheckoutResponse | void> => {
    const userId = requireBillingUser(context, request, reply);
    if (!userId) return;
    const url = purchaseUrl(context.env.stripePaymentLinkUrl, userId);
    if (!url) {
      return reply.code(503).send({ ok: false, error: 'token purchase link is not configured' });
    }
    return { url };
  });
}
