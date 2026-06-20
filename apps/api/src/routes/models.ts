import type { ModelsResponse, OpenRouterModelDto } from '@shader-oracle/shared';
import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './context.js';

const OPENROUTER_MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
const MODEL_CACHE_MS = 5 * 60 * 1000;

type FetchResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
};

type OpenRouterModelPayload = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  pricing?: unknown;
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
  supported_parameters?: unknown;
};

type OpenRouterModelsPayload = {
  data?: OpenRouterModelPayload[];
};

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length > 0 ? strings : undefined;
}

function pricing(value: unknown): OpenRouterModelDto['pricing'] {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  return {
    prompt: typeof raw.prompt === 'string' ? raw.prompt : undefined,
    completion: typeof raw.completion === 'string' ? raw.completion : undefined,
    image: typeof raw.image === 'string' ? raw.image : undefined,
    request: typeof raw.request === 'string' ? raw.request : undefined,
  };
}

function normalizeModel(model: OpenRouterModelPayload): OpenRouterModelDto | undefined {
  if (typeof model.id !== 'string' || model.id.trim().length === 0) return undefined;

  const outputModalities = stringArray(model.architecture?.output_modalities);
  if (outputModalities && !outputModalities.includes('text')) return undefined;

  const contextLength =
    typeof model.context_length === 'number' && Number.isFinite(model.context_length)
      ? model.context_length
      : undefined;

  return {
    id: model.id,
    name: typeof model.name === 'string' && model.name.trim() ? model.name : model.id,
    description: typeof model.description === 'string' ? model.description : undefined,
    contextLength,
    pricing: pricing(model.pricing),
    inputModalities: stringArray(model.architecture?.input_modalities),
    outputModalities,
    supportedParameters: stringArray(model.supported_parameters),
  };
}

export async function registerModelRoutes(
  app: FastifyInstance,
  context: RouteContext,
): Promise<void> {
  let cached: { expiresAt: number; response: ModelsResponse } | undefined;

  app.get('/models', async (_request, reply) => {
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.response;

    const headers: Record<string, string> = {};
    if (context.env.openrouterApiKey) {
      headers.Authorization = `Bearer ${context.env.openrouterApiKey}`;
    }

    const response = (await fetch(OPENROUTER_MODELS_ENDPOINT, { headers })) as FetchResponse;
    if (!response.ok) {
      const detail = await response.text();
      return reply.code(502).send({
        ok: false,
        error: `OpenRouter models API error ${response.status}: ${detail.slice(0, 240)}`,
      });
    }

    const payload = (await response.json()) as OpenRouterModelsPayload;
    const models = (payload.data ?? [])
      .map(normalizeModel)
      .filter((model): model is OpenRouterModelDto => Boolean(model))
      .sort((a, b) => a.id.localeCompare(b.id));

    const catalog = models.some((model) => model.id === context.modelClient.defaultModel)
      ? models
      : [
          {
            id: context.modelClient.defaultModel,
            name: context.modelClient.defaultModel,
            outputModalities: ['text'],
          },
          ...models,
        ];

    cached = {
      expiresAt: now + MODEL_CACHE_MS,
      response: {
        defaultModel: context.modelClient.defaultModel,
        provider: context.modelClient.providerName,
        models: catalog,
        fetchedAt: new Date(now).toISOString(),
      },
    };

    return cached.response;
  });
}
