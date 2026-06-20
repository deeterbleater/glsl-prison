import type { FastifyInstance, FastifyRequest } from 'fastify';
import Stripe from 'stripe';
import { GLSL_CHAT_PURCHASE_TOKENS, GLSL_CHAT_PURCHASE_USD_CENTS } from '@shader-oracle/shared';
import type { RouteContext } from './context.js';

type RawBodyRequest = FastifyRequest & {
  rawBody?: string | Buffer;
};

function purchaseTokensFromCents(amountUsdCents: number): number {
  if (!Number.isFinite(amountUsdCents) || amountUsdCents <= 0) return 0;
  return Math.floor((amountUsdCents * GLSL_CHAT_PURCHASE_TOKENS) / GLSL_CHAT_PURCHASE_USD_CENTS);
}

function validClientReferenceId(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{1,200}$/.test(value));
}

async function handleCheckoutSession(
  context: RouteContext,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.payment_status !== 'paid') return;
  if (!validClientReferenceId(session.client_reference_id)) return;

  const amountUsdCents = session.amount_subtotal ?? session.amount_total ?? 0;
  const tokens = purchaseTokensFromCents(amountUsdCents);
  if (tokens <= 0) return;

  await context.repository.creditTokenPurchase({
    userId: session.client_reference_id,
    tokens,
    stripeEventId: event.id,
    stripeSessionId: session.id,
    amountUsdCents,
    description: `Stripe token purchase: ${tokens} glsl.chat tokens`,
  });
}

export async function registerStripeRoutes(
  app: FastifyInstance,
  context: RouteContext,
): Promise<void> {
  app.post('/stripe/webhook', { config: { rawBody: true } }, async (request, reply) => {
    if (!context.env.stripeSecretKey || !context.env.stripeWebhookSecret) {
      return reply.code(503).send({ ok: false, error: 'stripe webhook is not configured' });
    }

    const rawBody = (request as RawBodyRequest).rawBody;
    const signature = request.headers['stripe-signature'];
    if (!rawBody || typeof signature !== 'string') {
      return reply.code(400).send({ ok: false, error: 'invalid stripe webhook payload' });
    }

    const stripe = new Stripe(context.env.stripeSecretKey);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, context.env.stripeWebhookSecret);
    } catch {
      return reply.code(400).send({ ok: false, error: 'invalid stripe webhook signature' });
    }

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      await handleCheckoutSession(context, event, event.data.object as Stripe.Checkout.Session);
    }

    return { ok: true };
  });
}
