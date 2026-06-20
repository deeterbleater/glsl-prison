const FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
  [/\blayout\b/i, 'layout declarations are not available'],
  [/\bin\s+vec[234]\b/i, 'custom fragment inputs are not available'],
  [/\bsampler\w*\b/i, 'samplers are not available'],
  [/\btexture\s*\(/i, 'texture access is not available'],
  [/\bdiscard\b/i, 'discard is not allowed'],
  [/\bgl_FragColor\b/i, 'use out vec4 o instead of gl_FragColor'],
  [/for\s*\(\s*;\s*;\s*\)/i, 'unbounded for loops are not allowed'],
  [/\bwhile\s*\(/i, 'while loops are not allowed'],
  [/\bdo\s*\{/i, 'do loops are not allowed'],
];

const HELPER_FUNCTION_PATTERN =
  /\b(?:float|int|bool|vec[234]|mat[234]|void)\s+(?!main\b)[A-Za-z_]\w*\s*\([^;{}]*\)\s*\{/i;

const ALLOWED_UNIFORMS = new Map([
  ['r', 'vec2'],
  ['t', 'float'],
  ['m', 'vec4'],
]);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function hasBalancedDelimiters(source: string): boolean {
  const pairs: Record<string, string> = {
    ')': '(',
    '}': '{',
    ']': '[',
  };
  const openers = new Set(Object.values(pairs));
  const stack: string[] = [];

  for (const char of source) {
    if (openers.has(char)) stack.push(char);
    if (char in pairs && stack.pop() !== pairs[char]) return false;
  }

  return stack.length === 0;
}

function validateVersionDirectives(source: string): string | undefined {
  const versions = [...source.matchAll(/^\s*#version\s+([^\n]+)$/gim)];
  if (versions.length === 0) return undefined;
  if (versions.length > 1) return 'shader source has multiple #version declarations';

  const directive = versions[0]?.[1]?.trim();
  return directive === '300 es' ? undefined : '#version must be 300 es';
}

function validateUniforms(source: string): string | undefined {
  const uniforms = source.matchAll(
    /\buniform\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:\[[^\]]+\])?\s*;/g,
  );

  for (const match of uniforms) {
    const type = match[1] ?? '';
    const name = match[2] ?? '';
    if (ALLOWED_UNIFORMS.get(name) !== type) {
      return `uniform ${name || type} is not available`;
    }
  }

  return undefined;
}

function validateOutputs(source: string): string | undefined {
  const outputs = source.matchAll(/\bout\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*;/g);

  for (const match of outputs) {
    const type = match[1] ?? '';
    const name = match[2] ?? '';
    if (type !== 'vec4' || name !== 'o') return 'only out vec4 o is available';
  }

  return undefined;
}

export function sanitizeFragmentShader(
  source: string,
  options: { charLimit?: number } = {},
): { ok: true; cleaned: string } | { ok: false; reason: string } {
  const charLimit = options.charLimit ?? 4000;
  let cleaned = source.replace(/\r\n?/g, '\n').trim();

  const fenceMatch = cleaned.match(/^```(?:glsl|c|cpp|shader)?\s*\n([\s\S]*?)\n?```$/i);
  if (fenceMatch?.[1]) cleaned = fenceMatch[1].trim();

  if (cleaned.length === 0) return { ok: false, reason: 'empty shader source' };
  if (cleaned.length > charLimit) {
    return { ok: false, reason: `shader source exceeds ${charLimit} characters` };
  }

  const sourceForChecks = stripComments(cleaned);
  if (!hasBalancedDelimiters(sourceForChecks)) {
    return { ok: false, reason: 'shader source has unbalanced delimiters' };
  }

  for (const [pattern, reason] of FORBIDDEN_PATTERNS) {
    if (pattern.test(sourceForChecks)) return { ok: false, reason };
  }

  const hasMain = /\bvoid\s+main\s*\(/i.test(sourceForChecks);
  if (!hasMain && HELPER_FUNCTION_PATTERN.test(sourceForChecks)) {
    return {
      ok: false,
      reason: 'helper functions require a fragment shader source with void main',
    };
  }

  const versionProblem = validateVersionDirectives(sourceForChecks);
  if (versionProblem) return { ok: false, reason: versionProblem };

  const uniformProblem = validateUniforms(sourceForChecks);
  if (uniformProblem) return { ok: false, reason: uniformProblem };

  const outputProblem = validateOutputs(sourceForChecks);
  if (outputProblem) return { ok: false, reason: outputProblem };

  const forLoops = sourceForChecks.matchAll(/\bfor\s*\(([^)]*)\)/gi);
  for (const match of forLoops) {
    const header = match[1] ?? '';
    const numericBound = header.match(/[<>=!]=?\s*(\d+)/);
    if (!numericBound?.[1]) {
      return { ok: false, reason: 'for loops must have an obvious numeric bound' };
    }
    const bound = Number.parseInt(numericBound[1], 10);
    if (!Number.isFinite(bound) || bound > 128) {
      return { ok: false, reason: 'for loop bounds must be 128 or lower' };
    }
  }

  return { ok: true, cleaned };
}

export const sanitizeShaderBody = sanitizeFragmentShader;
