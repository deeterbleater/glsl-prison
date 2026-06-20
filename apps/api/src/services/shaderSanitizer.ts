const FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
  [/#version\b/i, '#version declarations are not allowed in body mode'],
  [/\bprecision\b/i, 'precision declarations are not allowed in body mode'],
  [/\buniform\b/i, 'uniform declarations are not allowed in body mode'],
  [/\blayout\b/i, 'layout declarations are not allowed in body mode'],
  [/\bin\s+vec[234]\b/i, 'fragment inputs are not allowed in body mode'],
  [/\bout\s+vec[234]\b/i, 'fragment outputs are not allowed in body mode'],
  [/\bvoid\s+main\s*\(/i, 'void main is not allowed in body mode'],
  [/\bsampler\w*\b/i, 'samplers are not available in body mode'],
  [/\btexture\s*\(/i, 'texture access is not available in body mode'],
  [/\bdiscard\b/i, 'discard is not allowed in body mode'],
  [
    /\b(?:float|int|bool|vec[234]|mat[234])\s+[A-Za-z_]\w*\s*\([^;{}]*\)\s*\{/i,
    'helper function definitions are not allowed in body mode',
  ],
  [/for\s*\(\s*;\s*;\s*\)/i, 'unbounded for loops are not allowed'],
  [/\bwhile\s*\(/i, 'while loops are not allowed'],
  [/\bdo\s*\{/i, 'do loops are not allowed'],
];

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

export function sanitizeShaderBody(
  source: string,
  options: { charLimit?: number } = {},
): { ok: true; cleaned: string } | { ok: false; reason: string } {
  const charLimit = options.charLimit ?? 4000;
  let cleaned = source.replace(/\r\n?/g, '\n').trim();

  const fenceMatch = cleaned.match(/^```(?:glsl|c|cpp|shader)?\s*\n([\s\S]*?)\n?```$/i);
  if (fenceMatch?.[1]) cleaned = fenceMatch[1].trim();

  if (cleaned.length === 0) return { ok: false, reason: 'empty shader body' };
  if (cleaned.length > charLimit) {
    return { ok: false, reason: `shader body exceeds ${charLimit} characters` };
  }

  const sourceForChecks = stripComments(cleaned);
  if (!hasBalancedDelimiters(sourceForChecks)) {
    return { ok: false, reason: 'shader body has unbalanced delimiters' };
  }

  for (const [pattern, reason] of FORBIDDEN_PATTERNS) {
    if (pattern.test(sourceForChecks)) return { ok: false, reason };
  }

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
