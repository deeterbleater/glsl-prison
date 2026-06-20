import type { ModelClient } from './modelClient.js';
import { sanitizeFragmentShader } from './shaderSanitizer.js';

export async function repairOnce(input: {
  modelClient: ModelClient;
  prompt: string;
  fragment: string;
  compileLog: string;
  model: string;
  charLimit: number;
}): Promise<string> {
  const repaired = await input.modelClient.repairShader({
    prompt: input.prompt,
    fragment: input.fragment,
    compileLog: input.compileLog,
    model: input.model,
    charLimit: input.charLimit,
  });
  const sanitized = sanitizeFragmentShader(repaired, { charLimit: input.charLimit });
  if (!sanitized.ok) throw new Error(`Repaired shader rejected: ${sanitized.reason}`);
  return sanitized.cleaned;
}
