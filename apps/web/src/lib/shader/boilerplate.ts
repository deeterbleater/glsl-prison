export const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

const vec2 verts[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2( 3.0, -1.0),
  vec2(-1.0,  3.0)
);

void main() {
  gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0);
}`;

export const SAMPLE_FRAGMENT_BODY = `float d = length(p);
col = 0.5 + 0.5*cos(T + vec3(0,2,4) + d*8.0);`;

export const FRAGMENT_INTERFACE_SOURCE = `#version 300 es
precision highp float;

uniform vec2 r;
uniform float t;
uniform vec4 m;

out vec4 o;

#define R r
#define T t
#define M m
#define FC gl_FragCoord.xy
#define PI 3.141592653589793
#define TAU 6.283185307179586`;

export const FRAGMENT_BODY_HELPERS = `
float sat(float x) { return clamp(x, 0.0, 1.0); }
vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * p;
}`;

export function wrapFragmentBody(body: string): string {
  return `${FRAGMENT_INTERFACE_SOURCE}
${FRAGMENT_BODY_HELPERS}

void main() {
  vec2 uv = gl_FragCoord.xy / r;
  vec2 p = (gl_FragCoord.xy * 2.0 - r) / min(r.x, r.y);
  vec3 col = vec3(0.0);

  // MODEL CODE START
${body}
  // MODEL CODE END

  o = vec4(col, 1.0);
}`;
}

function stripDuplicateInterface(source: string): string {
  return source
    .replace(/^\s*#version\s+300\s+es\s*$/gim, '')
    .replace(/\bprecision\s+(?:lowp|mediump|highp)\s+float\s*;/gi, '')
    .replace(/\buniform\s+vec2\s+r\s*;/gi, '')
    .replace(/\buniform\s+float\s+t\s*;/gi, '')
    .replace(/\buniform\s+vec4\s+m\s*;/gi, '')
    .replace(/\bout\s+vec4\s+o\s*;/gi, '')
    .trim();
}

export function normalizeFragmentSource(source: string): string {
  const cleaned = source.trim();
  if (!/\bvoid\s+main\s*\(/i.test(cleaned)) return wrapFragmentBody(cleaned);

  return `${FRAGMENT_INTERFACE_SOURCE}

${stripDuplicateInterface(cleaned)}`;
}
