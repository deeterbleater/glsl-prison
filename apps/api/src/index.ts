import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import rawBody from 'fastify-raw-body';
import type { FastifyRequest } from 'fastify';
import { createRepository } from './db/repository.js';
import { loadEnv } from './env.js';
import { registerAttemptRoutes } from './routes/attempts.js';
import { registerGenerateRoutes } from './routes/generate.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerJudgeRoutes } from './routes/judge.js';
import { registerModelRoutes } from './routes/models.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerStripeRoutes } from './routes/stripe.js';
import { registerBillingRoutes } from './routes/billing.js';
import { ModelCatalog } from './services/modelCatalog.js';
import { createModelClient } from './services/modelClient.js';
import { getRateLimitOptions } from './util/rateLimit.js';

const env = loadEnv();
if (env.clerkAuthRequired && !env.clerkSecretKey) {
  throw new Error('CLERK_SECRET_KEY is required when CLERK_AUTH_REQUIRED=true');
}

const app = Fastify({
  logger: true,
  bodyLimit: 5 * 1024 * 1024,
});

await app.register(cors, {
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('CORS origin is not allowed'), false);
  },
});

await app.register(rateLimit, getRateLimitOptions(env));
await app.register(rawBody, {
  field: 'rawBody',
  global: false,
  encoding: 'utf8',
  runFirst: true,
});

const clerk = env.clerkSecretKey ? await import('@clerk/fastify') : undefined;
if (clerk) await app.register(clerk.clerkPlugin);

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'request failed');
  const statusCode =
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    error.statusCode >= 400
      ? error.statusCode
      : 500;
  const message =
    statusCode >= 500
      ? 'internal server error'
      : error instanceof Error
        ? error.message
        : 'request failed';
  reply.code(statusCode).send({ ok: false, error: message });
});

const modelClient = createModelClient(env);
const context = {
  env,
  repository: createRepository(env),
  modelClient,
  modelCatalog: new ModelCatalog(env, {
    defaultModel: modelClient.defaultModel,
    providerName: modelClient.providerName,
  }),
  auth: {
    enabled: Boolean(clerk),
    required: env.clerkAuthRequired,
    getUserId(request: FastifyRequest) {
      if (!clerk) return undefined;
      const auth = clerk.getAuth(request);
      return auth.isAuthenticated ? (auth.userId ?? undefined) : undefined;
    },
  },
};

await registerHealthRoutes(app);
await registerStripeRoutes(app, context);
await registerModelRoutes(app, context);
await registerBillingRoutes(app, context);
await registerGenerateRoutes(app, context);
await registerAttemptRoutes(app, context);
await registerJudgeRoutes(app, context);
await registerRunRoutes(app, context);

const address = await app.listen({ port: env.port, host: env.host });
app.log.info(`Shader Oracle API listening at ${address}`);
