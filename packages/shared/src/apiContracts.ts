import type { CaptureFrame, JudgeScore, RunDto, ShaderStats } from './types.js';
import type { LegacyShaderMode, ShaderMode } from './shaderModes.js';

export type GenerateRequest = {
  prompt: string;
  mode?: ShaderMode | LegacyShaderMode;
  model?: string;
  constraints?: {
    charLimit?: number;
    allowRepair?: boolean;
    maxRepairAttempts?: number;
  };
};

export type GenerateResponse = {
  runId: string;
  attemptId: string;
  fragment: string;
  mode: ShaderMode;
  model: string;
  status: 'generated';
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
  inputModalities?: string[];
  outputModalities?: string[];
  supportedParameters?: string[];
};

export type ModelsResponse = {
  defaultModel: string;
  provider: string;
  models: OpenRouterModelDto[];
  fetchedAt: string;
};

export type PublishRequest = {
  public: boolean;
};

export type PublishResponse = {
  ok: true;
  shareUrl: string;
};
