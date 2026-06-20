# Shader Oracle

Shader Oracle is a Vite/React + Fastify monorepo where the model answers prompts by producing executable GLSL ES 300 fragment shader source. The browser normalizes, compiles, renders, captures, and reports diagnostics; the API stores runs and attempts, repairs failed shaders, and judges successful attempts.

## Workspace

```txt
apps/web        Vercel frontend: prompt UI, shader editor, WebGL2 renderer, share pages
apps/api        Vultr API: generation, repair, judging, persistence, rate limiting
packages/shared Shared TypeScript contracts
deploy          systemd and nginx templates for the API host
```

## Local Dev

```sh
pnpm install
pnpm --filter @shader-oracle/api dev
pnpm --filter @shader-oracle/web dev
```

The API defaults to an in-memory store when `DATABASE_URL` is unset. Copy `apps/api/.env.example` to `apps/api/.env` when you want Postgres, provider keys, or CORS overrides.

```sh
pnpm --filter @shader-oracle/api prisma:generate
pnpm --filter @shader-oracle/api prisma:migrate
```

Copy `apps/web/.env.example` to `apps/web/.env` and set:

```txt
VITE_API_BASE_URL=https://api.ufotoken.app
```

When running the frontend on localhost without this variable, it automatically uses `http://localhost:8080`. Hosted builds default to `https://api.ufotoken.app`.

## Model Provider

The API uses a provider-neutral `ModelClient`. With `OPENROUTER_API_KEY` set, it calls OpenRouter's chat completions API. With `OPENAI_API_KEY` set and no OpenRouter key, it calls the OpenAI Responses API. Without a provider key, it uses deterministic local shader and judge fallbacks so the app remains runnable.

For local OpenRouter dev, keep secrets in the ignored `apps/api/.env` file:

```txt
OPENROUTER_API_KEY=...
OPENROUTER_DEFAULT_MODEL=openai/gpt-5.2
```

The core invariant is strict: model output is shader source, not prose. Backend sanitation strips Markdown fences, allows helper functions in fragment source, rejects unsupported GLSL declarations/tokens, rejects unbounded loops, and caps loop bounds at `128`.

## Deploy

Frontend on Vercel:

```txt
Framework preset: Vite
Root directory: repository root
Build command: pnpm --filter @shader-oracle/web build
Output directory: apps/web/dist
```

Do not point the Vercel project at `apps/api`; the API is intended for the Vultr host.

Set the production API CORS env to include the hosted chat client:

```txt
CORS_ORIGIN=https://glsl.chat,https://www.glsl.chat
PUBLIC_WEB_BASE_URL=https://glsl.chat
```

Backend target:

```txt
Ubuntu 24.04 LTS
Node.js 22+
PostgreSQL 16+
nginx
certbot
systemd
```

Use the templates in `deploy/` for `systemd` and nginx. The API should run from `/opt/shader-oracle/api`, with captures under `/var/lib/shader-oracle/captures`.

## Useful Commands

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm format
```
