import type { CaptureFrame } from '@shader-oracle/shared';
import type { ShaderRenderer } from './render';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function captureFrames(renderer: ShaderRenderer): Promise<CaptureFrame[]> {
  const frames: CaptureFrame[] = [];
  for (let index = 0; index < 3; index += 1) {
    if (index > 0) await delay(450);
    frames.push({
      t: Number(renderer.getTimeSeconds().toFixed(2)),
      dataUrl: renderer.captureFrame(),
    });
  }
  return frames;
}
