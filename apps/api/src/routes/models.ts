import type { ModelsResponse, OpenRouterModelDto, ReasoningEffort } from '@shader-oracle/shared';
import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './context.js';

const OPENROUTER_MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
const MODEL_CACHE_MS = 5 * 60 * 1000;

const FEATURED_MODELS: OpenRouterModelDto[] = [
  { id: 'openai/gpt-5.2', name: 'OpenAI: GPT-5.2', outputModalities: ['text'] },
  { id: 'openai/gpt-5.2-chat', name: 'OpenAI: GPT-5.2 Chat', outputModalities: ['text'] },
  { id: 'openai/gpt-5.2-codex', name: 'OpenAI: GPT-5.2-Codex', outputModalities: ['text'] },
  {
    id: 'anthropic/claude-sonnet-4.6',
    name: 'Anthropic: Claude Sonnet 4.6',
    outputModalities: ['text'],
  },
  {
    id: 'anthropic/claude-opus-4.8',
    name: 'Anthropic: Claude Opus 4.8',
    outputModalities: ['text'],
  },
  {
    id: 'google/gemini-3.1-pro-preview',
    name: 'Google: Gemini 3.1 Pro Preview',
    outputModalities: ['text'],
  },
  { id: 'x-ai/grok-4.3', name: 'xAI: Grok 4.3', outputModalities: ['text'] },
  { id: 'qwen/qwen3-coder-next', name: 'Qwen: Qwen3 Coder Next', outputModalities: ['text'] },
  {
    id: 'moonshotai/kimi-k2.7-code',
    name: 'MoonshotAI: Kimi K2.7 Code',
    outputModalities: ['text'],
  },
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek: DeepSeek V4 Pro', outputModalities: ['text'] },
  { id: 'z-ai/glm-5.2', name: 'Z.ai: GLM 5.2', outputModalities: ['text'] },
  { id: 'openrouter/fusion', name: 'OpenRouter: Fusion', outputModalities: ['text'] },
  {
    id: 'cohere/north-mini-code:free',
    name: 'Cohere: North Mini Code (free)',
    outputModalities: ['text'],
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'NVIDIA: Nemotron 3 Ultra (free)',
    outputModalities: ['text'],
  },
];

const FEATURED_MODEL_IDS = FEATURED_MODELS.map((model) => model.id);

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
  reasoning?: {
    supported_efforts?: unknown;
    default_effort?: unknown;
    default_enabled?: unknown;
    mandatory?: unknown;
    supports_max_tokens?: unknown;
  };
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

function reasoningEffort(value: unknown): ReasoningEffort | undefined {
  return value === 'none' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
    ? value
    : undefined;
}

function reasoningEfforts(value: unknown): ReasoningEffort[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const efforts = value
    .map(reasoningEffort)
    .filter((effort): effort is ReasoningEffort => Boolean(effort));
  return efforts.length > 0 ? efforts : undefined;
}

function reasoning(value: OpenRouterModelPayload['reasoning']): OpenRouterModelDto['reasoning'] {
  if (!value || typeof value !== 'object') return undefined;
  return {
    supportedEfforts: reasoningEfforts(value.supported_efforts),
    defaultEffort: reasoningEffort(value.default_effort),
    defaultEnabled: typeof value.default_enabled === 'boolean' ? value.default_enabled : undefined,
    mandatory: typeof value.mandatory === 'boolean' ? value.mandatory : undefined,
    supportsMaxTokens:
      typeof value.supports_max_tokens === 'boolean' ? value.supports_max_tokens : undefined,
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
    reasoning: reasoning(model.reasoning),
  };
}

function buildCatalog(models: OpenRouterModelDto[]): OpenRouterModelDto[] {
  const byId = new Map(models.map((model) => [model.id, model]));
  for (const model of FEATURED_MODELS) {
    if (!byId.has(model.id)) byId.set(model.id, model);
  }

  const featured = FEATURED_MODEL_IDS.map((id) => byId.get(id)).filter(
    (model): model is OpenRouterModelDto => Boolean(model),
  );
  const rest = [...byId.values()]
    .filter((model) => !FEATURED_MODEL_IDS.includes(model.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  return [...featured, ...rest];
}

function modelsResponse(
  context: RouteContext,
  models: OpenRouterModelDto[],
  fetchedAt: number,
): ModelsResponse {
  return {
    defaultModel: context.modelClient.defaultModel,
    provider: context.modelClient.providerName,
    models: buildCatalog(models),
    featuredModelIds: FEATURED_MODEL_IDS,
    fetchedAt: new Date(fetchedAt).toISOString(),
  };
}

export async function registerModelRoutes(
  app: FastifyInstance,
  context: RouteContext,
): Promise<void> {
  let cached: { expiresAt: number; response: ModelsResponse } | undefined;

  app.get('/models', async () => {
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.response;

    const headers: Record<string, string> = {};
    if (context.env.openrouterApiKey) {
      headers.Authorization = `Bearer ${context.env.openrouterApiKey}`;
    }

    const response = (await fetch(OPENROUTER_MODELS_ENDPOINT, { headers }).catch(
      () => undefined,
    )) as FetchResponse | undefined;
    if (!response) return modelsResponse(context, FEATURED_MODELS, now);

    if (!response.ok) {
      return modelsResponse(context, FEATURED_MODELS, now);
    }

    const payload = (await response.json()) as OpenRouterModelsPayload;
    const models = (payload.data ?? [])
      .map(normalizeModel)
      .filter((model): model is OpenRouterModelDto => Boolean(model))
      .sort((a, b) => a.id.localeCompare(b.id));

    cached = {
      expiresAt: now + MODEL_CACHE_MS,
      response: modelsResponse(context, models, now),
    };

    return cached.response;
  });
}
