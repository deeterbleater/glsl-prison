import 'dotenv/config';

export type Env = {
  nodeEnv: string;
  port: number;
  host: string;
  databaseUrl?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  openrouterApiKey?: string;
  openrouterAppUrl: string;
  openrouterAppTitle: string;
  clerkSecretKey?: string;
  clerkPublishableKey?: string;
  clerkAuthRequired: boolean;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripePaymentLinkUrl?: string;
  defaultModel: string;
  openrouterDefaultModel: string;
  corsOrigins: string[];
  captureStorageDir: string;
  publicCaptureBaseUrl: string;
  publicWebBaseUrl: string;
  rateLimitPerMinute: number;
};

function optional(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

export function loadEnv(): Env {
  const clerkSecretKey = optional(process.env.CLERK_SECRET_KEY);
  const configuredCorsOrigins = (
    process.env.CORS_ORIGIN ?? 'http://localhost:5173,https://glsl.chat,https://www.glsl.chat'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const corsOrigins = Array.from(
    new Set([
      ...configuredCorsOrigins,
      'http://localhost:5173',
      'https://glsl.chat',
      'https://www.glsl.chat',
    ]),
  );

  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: intFromEnv('PORT', 8080),
    host:
      process.env.HOST?.trim() || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
    databaseUrl: optional(process.env.DATABASE_URL),
    openaiApiKey: optional(process.env.OPENAI_API_KEY),
    anthropicApiKey: optional(process.env.ANTHROPIC_API_KEY),
    openrouterApiKey: optional(process.env.OPENROUTER_API_KEY),
    openrouterAppUrl: process.env.OPENROUTER_APP_URL?.trim() || 'http://localhost:5173',
    openrouterAppTitle: process.env.OPENROUTER_APP_TITLE?.trim() || 'Shader Oracle',
    clerkSecretKey,
    clerkPublishableKey: optional(process.env.CLERK_PUBLISHABLE_KEY),
    clerkAuthRequired: boolFromEnv('CLERK_AUTH_REQUIRED', Boolean(clerkSecretKey)),
    stripeSecretKey: optional(process.env.STRIPE_SECRET_KEY),
    stripeWebhookSecret: optional(process.env.STRIPE_WEBHOOK_SECRET),
    stripePaymentLinkUrl:
      optional(process.env.STRIPE_PAYMENT_LINK_URL) ||
      'https://buy.stripe.com/eVq4gz9IP8DaaYmcKU5AQ00',
    defaultModel: process.env.DEFAULT_MODEL?.trim() || 'gpt-5-mini',
    openrouterDefaultModel:
      process.env.OPENROUTER_DEFAULT_MODEL?.trim() ||
      process.env.DEFAULT_MODEL?.trim() ||
      'openai/gpt-5.2',
    corsOrigins,
    captureStorageDir: process.env.CAPTURE_STORAGE_DIR?.trim() || '/var/lib/shader-oracle/captures',
    publicCaptureBaseUrl:
      process.env.PUBLIC_CAPTURE_BASE_URL?.trim() || 'https://api.yourdomain.com/captures',
    publicWebBaseUrl: process.env.PUBLIC_WEB_BASE_URL?.trim() || 'http://localhost:5173',
    rateLimitPerMinute: intFromEnv('RATE_LIMIT_PER_MINUTE', 20),
  };
}
