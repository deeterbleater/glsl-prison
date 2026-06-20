import type { ModelClient } from './modelClient.js';
import type { ReasoningEffort } from '@shader-oracle/shared';
import { sanitizeFragmentShader } from './shaderSanitizer.js';

type VerifiedShader = {
  fragment: string;
  attempts: number;
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
  const sanitized = sanitizeFragmentShader(generated, { charLimit: input.charLimit });
  if (sanitized.ok) return { fragment: sanitized.cleaned, attempts: 1 };

  const repaired = await repairWithVerification({
    modelClient: input.modelClient,
    prompt: input.prompt,
    fragment: generated,
    compileLog: verifierLog(sanitized.reason, input.charLimit),
    model: input.model,
    charLimit: input.charLimit,
    maxAttempts: input.maxRepairAttempts,
    reasoningEffort: input.reasoningEffort,
  });

  return { fragment: repaired.fragment, attempts: repaired.attempts + 1 };
}

export async function repairOnce(input: {
  modelClient: ModelClient;
  prompt: string;
  fragment: string;
  compileLog: string;
  model: string;
  charLimit: number;
  reasoningEffort?: ReasoningEffort;
}): Promise<string> {
  const repaired = await repairWithVerification({
    ...input,
    maxAttempts: 3,
  });
  return repaired.fragment;
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
    const sanitized = sanitizeFragmentShader(repaired, { charLimit: input.charLimit });
    if (sanitized.ok) return { fragment: sanitized.cleaned, attempts: attempt };

    reasons.push(sanitized.reason);
    fragment = repaired;
    compileLog = verifierLog(sanitized.reason, input.charLimit);
  }

  throw verificationError(reasons);
}
