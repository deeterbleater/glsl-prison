import type { ModelClient, ModelUsage } from './modelClient.js';
import type { ReasoningEffort } from '@shader-oracle/shared';
import { sanitizeFragmentShader } from './shaderSanitizer.js';

type VerifiedShader = {
  fragment: string;
  attempts: number;
  usages: ModelUsage[];
};

function verifierLog(reason: string, charLimit: number): string {
  return `Shader verification failed before rendering: ${reason}.
Return corrected GLSL ES 300 fragment shader source only.
The source must be under ${charLimit} characters after comments are removed.
Use only uniform vec2 r, uniform float t, uniform vec4 m, and out vec4 o.
Keep helper functions compact and do not include comments.`;
}

function verificationError(reasons: string[]): Error {
  const lastReason = reasons.at(-1) ?? 'unknown verifier rejection';
  return new Error(`shader verification failed after retries: ${lastReason}`);
}

export async function generateWithVerification(input: {
  modelClient: ModelClient;
  prompt: string;
  model: string;
  charLimit: number;
  maxRepairAttempts: number;
  reasoningEffort?: ReasoningEffort;
}): Promise<VerifiedShader> {
  const generated = await input.modelClient.generateShader({
    prompt: input.prompt,
    model: input.model,
    charLimit: input.charLimit,
    reasoningEffort: input.reasoningEffort,
  });
  const usages = generated.usage ? [generated.usage] : [];
  const sanitized = sanitizeFragmentShader(generated.text, { charLimit: input.charLimit });
  if (sanitized.ok) return { fragment: sanitized.cleaned, attempts: 1, usages };

  const repaired = await repairWithVerification({
    modelClient: input.modelClient,
    prompt: input.prompt,
    fragment: generated.text,
    compileLog: verifierLog(sanitized.reason, input.charLimit),
    model: input.model,
    charLimit: input.charLimit,
    maxAttempts: input.maxRepairAttempts,
    reasoningEffort: input.reasoningEffort,
  });

  return {
    fragment: repaired.fragment,
    attempts: repaired.attempts + 1,
    usages: [...usages, ...repaired.usages],
  };
}

export async function repairOnce(input: {
  modelClient: ModelClient;
  prompt: string;
  fragment: string;
  compileLog: string;
  model: string;
  charLimit: number;
  reasoningEffort?: ReasoningEffort;
}): Promise<VerifiedShader> {
  const repaired = await repairWithVerification({
    ...input,
    maxAttempts: 3,
  });
  return repaired;
}

export async function repairWithVerification(input: {
  modelClient: ModelClient;
  prompt: string;
  fragment: string;
  compileLog: string;
  model: string;
  charLimit: number;
  maxAttempts: number;
  reasoningEffort?: ReasoningEffort;
}): Promise<VerifiedShader> {
  const reasons: string[] = [];
  const usages: ModelUsage[] = [];
  let fragment = input.fragment;
  let compileLog = input.compileLog;

  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    const repaired = await input.modelClient.repairShader({
      prompt: input.prompt,
      fragment,
      compileLog,
      model: input.model,
      charLimit: input.charLimit,
      reasoningEffort: input.reasoningEffort,
    });
    if (repaired.usage) usages.push(repaired.usage);
    const sanitized = sanitizeFragmentShader(repaired.text, { charLimit: input.charLimit });
    if (sanitized.ok) return { fragment: sanitized.cleaned, attempts: attempt, usages };

    reasons.push(sanitized.reason);
    fragment = repaired.text;
    compileLog = verifierLog(sanitized.reason, input.charLimit);
  }

  throw verificationError(reasons);
}
