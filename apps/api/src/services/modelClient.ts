import type { CaptureFrame, JudgeScore, ShaderStats } from '@shader-oracle/shared';
import type { Env } from '../env.js';
import {
  GENERATION_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
  REPAIR_SYSTEM_PROMPT,
  generationUserPrompt,
  repairUserPrompt,
} from './shaderPrompt.js';
import { localScoreFromStats, normalizeJudgeScore } from './scoring.js';

export type GenerateShaderInput = {
  prompt: string;
  model: string;
  charLimit: number;
};

export type RepairShaderInput = {
  prompt: string;
  fragment: string;
  compileLog: string;
  model: string;
  charLimit: number;
};

export type JudgeAttemptInput = {
  prompt: string;
  fragment: string;
  stats?: ShaderStats;
  captures: CaptureFrame[];
  model: string;
};

export type JudgeResult = {
  score: JudgeScore;
  critique: string;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
};

export interface ModelClient {
  defaultModel: string;
  providerName: string;
  generateShader(input: GenerateShaderInput): Promise<string>;
  repairShader(input: RepairShaderInput): Promise<string>;
  judgeAttempt(input: JudgeAttemptInput): Promise<JudgeResult>;
}

function fallbackShader(prompt: string): string {
  const lowered = prompt.toLowerCase();
  const descent = lowered.includes('descent') || lowered.includes('gradient');
  const orbit =
    lowered.includes('orbit') || lowered.includes('solar') || lowered.includes('planet');

  if (descent) {
    return `float bowl = p.x*p.x*0.7 + pow(p.y + 0.25, 2.0);
float rings = smoothstep(0.04, 0.0, abs(fract(bowl*5.0 - T*0.2) - 0.5));
vec2 bead = vec2(0.75*cos(T*0.7), 0.25 + 0.55*sin(T*0.7));
bead.y -= 0.65*smoothstep(-1.0, 1.0, sin(T*0.9));
float particle = exp(-35.0*length(p - bead));
vec3 field = mix(vec3(0.03,0.05,0.08), vec3(0.08,0.22,0.31), sat(1.2 - bowl));
col = field + rings*vec3(0.2,0.75,0.9) + particle*vec3(1.0,0.85,0.25);`;
  }

  if (orbit) {
    return `vec3 base = vec3(0.01,0.015,0.03);
float sun = exp(-18.0*length(p));
vec2 a = vec2(cos(T), sin(T))*0.65;
vec2 b = vec2(cos(-T*1.7), sin(-T*1.7))*0.36;
float orbitA = smoothstep(0.012, 0.0, abs(length(p)-0.65));
float orbitB = smoothstep(0.01, 0.0, abs(length(p)-0.36));
float planetA = exp(-80.0*length(p-a));
float planetB = exp(-110.0*length(p-b));
col = base + sun*vec3(1.0,0.55,0.12) + orbitA*vec3(0.12,0.2,0.34) + orbitB*vec3(0.1,0.22,0.2);
col += planetA*vec3(0.2,0.65,1.0) + planetB*vec3(0.8,0.35,1.0);`;
  }

  return `float d = length(p);
float wave = sin(8.0*d - T*2.0) + sin(4.0*p.x + T) + sin(5.0*p.y - T*0.7);
vec3 palette = 0.5 + 0.5*cos(vec3(0.0,2.0,4.0) + wave + d*3.0);
float vignette = smoothstep(1.4, 0.2, d);
col = palette * vignette;`;
}

function maxTokensForCharLimit(charLimit: number): number {
  return Math.max(180, Math.min(2200, Math.ceil(charLimit / 1.5)));
}

function extractResponseText(response: any): string {
  if (typeof response.output_text === 'string') return response.output_text;

  const chunks: string[] = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join('\n').trim();
}

function parseJudgeJson(text: string): JudgeResult {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned) as {
    score?: Partial<JudgeScore>;
    critique?: string;
  } & Partial<JudgeScore>;
  const score = normalizeJudgeScore(parsed.score ?? parsed);
  return {
    score,
    critique: typeof parsed.critique === 'string' ? parsed.critique : 'No critique returned.',
  };
}

class LocalModelClient implements ModelClient {
  readonly providerName = 'local';

  constructor(readonly defaultModel: string) {}

  async generateShader(input: GenerateShaderInput): Promise<string> {
    return fallbackShader(input.prompt);
  }

  async repairShader(input: RepairShaderInput): Promise<string> {
    if (input.fragment.includes('foo(')) {
      return input.fragment.replace(/\bfoo\s*\([^)]*\)/g, 'vec3(length(p))');
    }
    return fallbackShader(input.prompt);
  }

  async judgeAttempt(input: JudgeAttemptInput): Promise<JudgeResult> {
    return {
      score: localScoreFromStats(input.stats),
      critique:
        input.captures.length > 0
          ? 'Local judge used compile stats and captured frame count. Configure OPENAI_API_KEY for semantic judging.'
          : 'Local judge used compile stats only. Configure OPENAI_API_KEY for semantic judging.',
    };
  }
}

class OpenAIResponsesClient implements ModelClient {
  private readonly endpoint = 'https://api.openai.com/v1/responses';
  readonly providerName = 'openai';
  readonly defaultModel: string;

  constructor(private readonly env: Env) {
    this.defaultModel = env.defaultModel;
  }

  async generateShader(input: GenerateShaderInput): Promise<string> {
    return this.textResponse({
      model: input.model,
      instructions: GENERATION_SYSTEM_PROMPT,
      input: generationUserPrompt(input.prompt, input.charLimit),
      maxOutputTokens: maxTokensForCharLimit(input.charLimit),
      temperature: 0.7,
    });
  }

  async repairShader(input: RepairShaderInput): Promise<string> {
    return this.textResponse({
      model: input.model,
      instructions: REPAIR_SYSTEM_PROMPT,
      input: repairUserPrompt(input),
      maxOutputTokens: maxTokensForCharLimit(input.charLimit),
      temperature: 0.35,
    });
  }

  async judgeAttempt(input: JudgeAttemptInput): Promise<JudgeResult> {
    const stats = input.stats ? JSON.stringify(input.stats) : 'No compile stats provided.';
    const text = await this.textResponse({
      model: input.model,
      instructions: JUDGE_SYSTEM_PROMPT,
      input: `Prompt:
"${input.prompt}"

Shader body:
${input.fragment}

Compile/frame stats:
${stats}

Captured frames: ${input.captures.length}. Return JSON only with score fields and critique.`,
      maxOutputTokens: 900,
      temperature: 0.2,
    });

    return parseJudgeJson(text);
  }

  private async textResponse(input: {
    model: string;
    instructions: string;
    input: string;
    maxOutputTokens: number;
    temperature: number;
  }): Promise<string> {
    if (!this.env.openaiApiKey) throw new Error('OPENAI_API_KEY is not configured');

    const response = (await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        instructions: input.instructions,
        input: input.input,
        max_output_tokens: input.maxOutputTokens,
        temperature: input.temperature,
      }),
    })) as FetchResponse;

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenAI Responses API error ${response.status}: ${detail.slice(0, 400)}`);
    }

    const payload = await response.json();
    const text = extractResponseText(payload);
    if (!text) throw new Error('Model response contained no text output');
    return text;
  }
}

class OpenRouterChatClient implements ModelClient {
  private readonly endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  readonly providerName = 'openrouter';
  readonly defaultModel: string;

  constructor(private readonly env: Env) {
    this.defaultModel = env.openrouterDefaultModel;
  }

  async generateShader(input: GenerateShaderInput): Promise<string> {
    return this.chatResponse({
      model: input.model,
      system: GENERATION_SYSTEM_PROMPT,
      user: generationUserPrompt(input.prompt, input.charLimit),
      maxTokens: maxTokensForCharLimit(input.charLimit),
      temperature: 0.7,
    });
  }

  async repairShader(input: RepairShaderInput): Promise<string> {
    return this.chatResponse({
      model: input.model,
      system: REPAIR_SYSTEM_PROMPT,
      user: repairUserPrompt(input),
      maxTokens: maxTokensForCharLimit(input.charLimit),
      temperature: 0.35,
    });
  }

  async judgeAttempt(input: JudgeAttemptInput): Promise<JudgeResult> {
    const stats = input.stats ? JSON.stringify(input.stats) : 'No compile stats provided.';
    const text = await this.chatResponse({
      model: input.model,
      system: JUDGE_SYSTEM_PROMPT,
      user: `Prompt:
"${input.prompt}"

Shader body:
${input.fragment}

Compile/frame stats:
${stats}

Captured frames: ${input.captures.length}. Return JSON only with score fields and critique.`,
      maxTokens: 900,
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
    });

    return parseJudgeJson(text);
  }

  private async chatResponse(input: {
    model: string;
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
    responseFormat?: { type: 'json_object' };
  }): Promise<string> {
    if (!this.env.openrouterApiKey) throw new Error('OPENROUTER_API_KEY is not configured');

    const response = (await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': this.env.openrouterAppUrl,
        'X-OpenRouter-Title': this.env.openrouterAppTitle,
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        max_tokens: input.maxTokens,
        reasoning_effort: 'none',
        temperature: input.temperature,
        verbosity: 'low',
        response_format: input.responseFormat,
      }),
    })) as FetchResponse;

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${detail.slice(0, 400)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string | null;
        native_finish_reason?: string | null;
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
      }>;
    };
    const choice = payload?.choices?.[0];
    if (
      choice?.finish_reason === 'length' ||
      choice?.native_finish_reason === 'max_output_tokens'
    ) {
      throw new Error('OpenRouter response hit the token limit before producing a complete shader');
    }

    const content = choice?.message?.content;
    if (typeof content === 'string' && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const text = content
        .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
        .join('\n')
        .trim();
      if (text) return text;
    }
    throw new Error('OpenRouter response contained no text output');
  }
}

export function createModelClient(env: Env): ModelClient {
  if (env.openrouterApiKey) return new OpenRouterChatClient(env);
  if (env.openaiApiKey) return new OpenAIResponsesClient(env);
  return new LocalModelClient(env.defaultModel);
}
