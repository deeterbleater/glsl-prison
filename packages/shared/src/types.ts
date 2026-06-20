import type { ShaderMode } from './shaderModes.js';

export type AttemptStatus = 'generated' | 'compiled' | 'compile_failed' | 'judged';

export type ShaderStats = {
  width: number;
  height: number;
  frameTimeMs: number;
  meanLuminance: number;
  variance: number;
  temporalDelta: number;
};

export type JudgeScore = {
  overall: number;
  promptFit: number;
  visualClarity: number;
  shaderIdiom: number;
  originality: number;
  technicalQuality: number;
};

export type CaptureFrame = {
  t: number;
  dataUrl: string;
};

export type AttemptDto = {
  id: string;
  runId: string;
  attemptNumber: number;
  fragment: string;
  mode: ShaderMode;
  model?: string;
  status: AttemptStatus;
  compileOk?: boolean;
  compileLog?: string;
  stats?: ShaderStats;
  score?: Partial<JudgeScore>;
  critique?: string;
  createdAt: string;
};

export type RunDto = {
  id: string;
  prompt: string;
  mode: ShaderMode;
  model?: string;
  public: boolean;
  createdAt: string;
  updatedAt: string;
  attempts: AttemptDto[];
};
