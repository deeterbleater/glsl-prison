import type { ShaderStats } from '@shader-oracle/shared';
import { compileFragmentShader, type ShaderCompileResult } from './compile';

type UniformLocations = {
  r: WebGLUniformLocation | null;
  t: WebGLUniformLocation | null;
  m: WebGLUniformLocation | null;
};

export class ShaderRenderer {
  private readonly gl: WebGL2RenderingContext;
  private program?: WebGLProgram;
  private uniforms: UniformLocations = { r: null, t: null, m: null };
  private frameHandle = 0;
  private startMs = performance.now();
  private previousMeanLuminance = 0;
  private latestFrameTimeMs = 0;
  private mouse = new Float32Array([0, 0, 0, 0]);

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not supported in this browser');
    this.gl = gl;
  }

  compile(fragmentSource: string): ShaderCompileResult {
    const result = compileFragmentShader(this.gl, fragmentSource);
    if (!result.ok || !result.program) return result;

    if (this.program) this.gl.deleteProgram(this.program);
    this.program = result.program;
    this.uniforms = {
      r: this.gl.getUniformLocation(this.program, 'r'),
      t: this.gl.getUniformLocation(this.program, 't'),
      m: this.gl.getUniformLocation(this.program, 'm'),
    };
    this.render(performance.now());
    this.start();
    return result;
  }

  start(): void {
    if (this.frameHandle) return;
    this.startMs = performance.now();
    const tick = (timeMs: number) => {
      const before = performance.now();
      this.render(timeMs);
      this.latestFrameTimeMs = performance.now() - before;
      this.frameHandle = requestAnimationFrame(tick);
    };
    this.frameHandle = requestAnimationFrame(tick);
  }

  stop(): void {
    if (!this.frameHandle) return;
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  destroy(): void {
    this.stop();
    if (this.program) this.gl.deleteProgram(this.program);
    this.program = undefined;
  }

  setMouse(clientX: number, clientY: number, down: boolean): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = rect.height - (clientY - rect.top);
    this.mouse[0] = x;
    this.mouse[1] = y;
    this.mouse[2] = down ? 1 : 0;
    this.mouse[3] = down ? 1 : 0;
  }

  getTimeSeconds(): number {
    return (performance.now() - this.startMs) / 1000;
  }

  captureFrame(): string {
    this.render(performance.now());
    return this.canvas.toDataURL('image/png');
  }

  measureStats(): ShaderStats {
    this.render(performance.now());
    const width = this.gl.drawingBufferWidth;
    const height = this.gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    this.gl.readPixels(0, 0, width, height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels);

    const stride = Math.max(1, Math.floor((width * height) / 6000));
    let count = 0;
    let sum = 0;
    let sumSq = 0;

    for (let pixel = 0; pixel < width * height; pixel += stride) {
      const offset = pixel * 4;
      const r = pixels[offset] ?? 0;
      const g = pixels[offset + 1] ?? 0;
      const b = pixels[offset + 2] ?? 0;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      sum += lum;
      sumSq += lum * lum;
      count += 1;
    }

    const meanLuminance = count > 0 ? sum / count : 0;
    const variance = count > 0 ? Math.max(0, sumSq / count - meanLuminance * meanLuminance) : 0;
    const temporalDelta = Math.abs(meanLuminance - this.previousMeanLuminance);
    this.previousMeanLuminance = meanLuminance;

    return {
      width,
      height,
      frameTimeMs: Number(this.latestFrameTimeMs.toFixed(2)),
      meanLuminance: Number(meanLuminance.toFixed(4)),
      variance: Number(variance.toFixed(4)),
      temporalDelta: Number(temporalDelta.toFixed(4)),
    };
  }

  private render(timeMs: number): void {
    if (!this.program) return;
    this.resizeToDisplay();
    const width = this.gl.drawingBufferWidth;
    const height = this.gl.drawingBufferHeight;

    this.gl.viewport(0, 0, width, height);
    this.gl.useProgram(this.program);
    this.gl.uniform2f(this.uniforms.r, width, height);
    this.gl.uniform1f(this.uniforms.t, (timeMs - this.startMs) / 1000);
    this.gl.uniform4fv(this.uniforms.m, this.mouse);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  private resizeToDisplay(): void {
    const scale = window.devicePixelRatio || 1;
    const width = Math.max(2, Math.floor(this.canvas.clientWidth * scale));
    const height = Math.max(2, Math.floor(this.canvas.clientHeight * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }
}
