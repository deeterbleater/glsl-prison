# GLSL Agent Harness Spec

## Project Name

**Shader Oracle** is a standalone web app where users prompt an AI model and the model answers only by producing executable GLSL ES 300 fragment shader code. The frontend is hosted on Vercel. The backend, database, and persistent services run on a Vultr-hosted Ubuntu box.

## Core Idea

Users enter natural-language prompts such as:

> Explain gradient descent visually.

The system asks a model to produce only GLSL fragment shader code compatible with a fixed WebGL2 harness. The frontend compiles and renders the shader in-browser. The backend stores prompts, generated shaders, attempts, compile logs, scores, captures, and shareable runs.

The model is not allowed to answer in prose. Its answer is the shader.

## Deployment Architecture

### Frontend

Hosted on Vercel.

Responsibilities:

- User interface
- Prompt input
- Shader editor
- WebGL2 shader compilation and rendering
- Local compile diagnostics
- Frame capture from canvas
- Calling backend API
- Displaying saved runs and attempt history
- Displaying model/judge metadata
- Share pages for public shaders

Recommended stack:

```txt
Vite
React
TypeScript
WebGL2
Simple CSS modules or plain CSS
```

No server-side rendering is required.

### Backend

Hosted on a Vultr Ubuntu box.

Responsibilities:

- Model API calls
- Prompt orchestration
- Shader repair loop
- Judge loop
- Database persistence
- Public share links
- Rate limiting
- API key isolation

Recommended stack:

```txt
Node.js 22+
Fastify
PostgreSQL
Prisma
systemd service
nginx reverse proxy
Let's Encrypt TLS
```

## Repo Structure

```txt
shader-oracle/
  apps/
    web/
      src/
        components/
        lib/
          api.ts
          shader/
            boilerplate.ts
            compile.ts
            render.ts
            capture.ts
        main.tsx
      index.html
      package.json
      vite.config.ts
      .env.example

    api/
      src/
        index.ts
        env.ts
        routes/
          generate.ts
          attempts.ts
          runs.ts
          judge.ts
          health.ts
        services/
          modelClient.ts
          shaderPrompt.ts
          repairLoop.ts
          judgeClient.ts
          scoring.ts
          shaderSanitizer.ts
        db/
          prisma.ts
          repository.ts
          schema.prisma
        util/
          ids.ts
          rateLimit.ts
      package.json
      tsconfig.json
      .env.example

  packages/
    shared/
      src/
        types.ts
        shaderModes.ts
        apiContracts.ts
      package.json

  deploy/
  README.md
  SPEC.md
  package.json
  pnpm-workspace.yaml
```

Use `pnpm`.

## Shader Runtime Contract

The model writes the body of a fragment shader that is injected into a fixed wrapper.

Default harness mode: `body`.

```glsl
#version 300 es
precision highp float;

uniform vec2 r;
uniform float t;
uniform vec4 m;

out vec4 o;

#define R r
#define T t
#define M m
#define FC gl_FragCoord.xy
#define PI 3.141592653589793
#define TAU 6.283185307179586

float sat(float x) { return clamp(x, 0.0, 1.0); }
vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * p;
}

void main() {
  vec2 uv = gl_FragCoord.xy / r;
  vec2 p = (gl_FragCoord.xy * 2.0 - r) / min(r.x, r.y);
  vec3 col = vec3(0.0);

  // MODEL CODE START
  {{MODEL_FRAGMENT_BODY}}
  // MODEL CODE END

  o = vec4(col, 1.0);
}
```

MVP supports body mode only.

## Shader Restrictions

Reject generated code containing:

```txt
#version
precision
uniform
layout
in vec
out vec
void main
sampler
texture
discard
```

Reject pathological loops:

```txt
for(;;)
while(
do {
```

Allow bounded `for` loops only. Reject obvious bounds greater than `128`.

## API Design

All backend routes are under `https://api.yourdomain.com`.

### `GET /health`

Returns:

```json
{
  "ok": true,
  "service": "shader-oracle-api",
  "version": "0.1.0"
}
```

### `POST /generate`

Request:

```json
{
  "prompt": "Explain gradient descent visually.",
  "mode": "body",
  "model": "default",
  "constraints": {
    "charLimit": 4000,
    "allowRepair": true,
    "maxRepairAttempts": 3
  }
}
```

Response:

```json
{
  "runId": "run_abc123",
  "attemptId": "att_abc123",
  "fragment": "col = vec3(...);",
  "mode": "body",
  "model": "default",
  "status": "generated"
}
```

The frontend compiles after receiving the fragment and reports compile results back to the backend.

### `POST /attempts/:attemptId/compile-result`

Reports browser compile success or failure.

### `POST /attempts/:attemptId/repair`

Repairs a failed shader using the original run prompt plus compile log.

### `POST /attempts/:attemptId/capture`

Uploads a small number of compressed PNG data URL frames for judging.

### `POST /attempts/:attemptId/judge`

Judges prompt fit, visual clarity, shader idiom, originality, technical quality, and overall quality.

### `GET /runs/:runId`

Returns a run with all attempts.

### `POST /runs/:runId/publish`

Marks a run public and returns a share URL.

## Database

Use PostgreSQL with Prisma models:

- `Run`
- `Attempt`
- `Capture`

For MVP, tiny PNG captures may be stored as data URLs, but production should prefer disk storage under `/var/lib/shader-oracle/captures` and save file paths or public URLs in Postgres.

## Environment

Frontend:

```txt
VITE_API_BASE_URL=https://api.yourdomain.com
```

Backend:

```txt
NODE_ENV=production
PORT=8080
DATABASE_URL=postgresql://shader_oracle:password@localhost:5432/shader_oracle
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=
OPENROUTER_DEFAULT_MODEL=openai/gpt-5.2
DEFAULT_MODEL=
CORS_ORIGIN=https://your-vercel-domain.vercel.app,https://shader-oracle.com
CAPTURE_STORAGE_DIR=/var/lib/shader-oracle/captures
PUBLIC_CAPTURE_BASE_URL=https://api.yourdomain.com/captures
RATE_LIMIT_PER_MINUTE=20
```

Backend provider keys must never be exposed to the frontend.

## MVP Definition Of Done

1. User can enter a prompt.
2. Backend generates shader body code.
3. Frontend wraps, compiles, and renders it.
4. Compile errors are visible.
5. User can request repair.
6. Successful attempts are saved.
7. User can open a share URL.
8. Public share page renders the saved shader.
9. Backend runs on Vultr Ubuntu behind nginx.
10. Frontend runs on Vercel.

## Core Invariant

The model answers by producing executable GLSL fragment shader code, not prose.
