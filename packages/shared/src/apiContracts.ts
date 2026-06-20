import type { CaptureFrame, JudgeScore, RunDto, ShaderStats } from './types.js';
import type { LegacyShaderMode, ShaderMode } from './shaderModes.js';
import type { GlslTokenPricing } from './pricing.js';

export type ReasoningEffort = 'auto' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type GenerateRequest = {
  prompt: string;
  mode?: ShaderMode | LegacyShaderMode;
  model?: string;
  constraints?: {
    charLimit?: number;
    allowRepair?: boolean;
    maxRepairAttempts?: number;
    reasoningEffort?: ReasoningEffort;
  };
};

export type GenerateResponse = {
  runId: string;
  attemptId: string;
  fragment: string;
  mode: ShaderMode;
  model: string;
  status: 'generated';
  billing?: BillingUsageResponse;
};

export type CompileResultRequest =
  | {
      ok: true;
      compileLog: string;
      stats: ShaderStats;
    }
  | {
      ok: false;
      compileLog: string;
    };

export type RepairRequest = {
  compileLog: string;
  fragment: string;
  reasoningEffort?: ReasoningEffort;
};

export type CaptureRequest = {
  frames: CaptureFrame[];
};

export type JudgeRequest = {
  judgeModel?: string;
};

export type JudgeResponse = {
  attemptId: string;
  score: JudgeScore;
  critique: string;
};

export type RunResponse = RunDto;

export type OpenRouterModelPricing = {
  prompt?: string;
  completion?: string;
  image?: string;
  request?: string;
};

export type OpenRouterModelDto = {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
  pricing?: OpenRouterModelPricing;
  glslTokenPricing?: GlslTokenPricing;
  inputModalities?: string[];
  outputModalities?: string[];
  supportedParameters?: string[];
  reasoning?: {
    supportedEfforts?: ReasoningEffort[];
    defaultEffort?: ReasoningEffort;
    defaultEnabled?: boolean;
    mandatory?: boolean;
    supportsMaxTokens?: boolean;
  };
};

export type ModelsResponse = {
  defaultModel: string;
  provider: string;
  models: OpenRouterModelDto[];
  featuredModelIds: string[];
  fetchedAt: string;
};

export type PublishRequest = {
  public: boolean;
};

export type PublishResponse = {
  ok: true;
  shareUrl: string;
};

export type BillingUsageResponse = {
  chargedTokens: number;
  balanceTokens: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsdMicros?: number;
};

export type BillingBalanceResponse = {
  userId: string;
  balanceTokens: number;
  purchaseUrl?: string;
  purchaseTokens: number;
  purchaseUsdCents: number;
  surchargeRate: number;
};

export type BillingCheckoutResponse = {
  url: string;
};
