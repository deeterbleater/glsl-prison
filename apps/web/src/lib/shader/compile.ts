import { VERTEX_SHADER_SOURCE, wrapFragmentBody } from './boilerplate';

export type ShaderCompileResult = {
  ok: boolean;
  log: string;
  program?: WebGLProgram;
};

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(log);
  }

  return shader;
}

export function compileFragmentBody(gl: WebGL2RenderingContext, body: string): ShaderCompileResult {
  let vertexShader: WebGLShader | undefined;
  let fragmentShader: WebGLShader | undefined;
  let program: WebGLProgram | undefined;

  try {
    vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, wrapFragmentBody(body));
    program = gl.createProgram() ?? undefined;
    if (!program) throw new Error('Unable to create WebGL program');

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'Unknown program link error');
    }

    return { ok: true, log: '', program };
  } catch (error) {
    if (program) gl.deleteProgram(program);
    return {
      ok: false,
      log: error instanceof Error ? error.message : 'Unknown shader compile error',
    };
  } finally {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
  }
}
