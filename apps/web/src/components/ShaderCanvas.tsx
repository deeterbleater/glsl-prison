import type { CaptureFrame, ShaderStats } from '@shader-oracle/shared';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { captureFrames } from '../lib/shader/capture';
import type { ShaderCompileResult } from '../lib/shader/compile';
import { ShaderRenderer } from '../lib/shader/render';

export type CompileSnapshot = {
  ok: boolean;
  log: string;
  stats?: ShaderStats;
};

export type ShaderCanvasHandle = {
  captureFrames: () => Promise<CaptureFrame[]>;
  measureStats: () => ShaderStats | undefined;
};

type ShaderCanvasProps = {
  fragment: string;
  onCompile?: (result: CompileSnapshot) => void;
};

export const ShaderCanvas = forwardRef<ShaderCanvasHandle, ShaderCanvasProps>(function ShaderCanvas(
  { fragment, onCompile },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<ShaderRenderer | null>(null);
  const [runtimeError, setRuntimeError] = useState<string>();
  const pointerDownRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      rendererRef.current = new ShaderRenderer(canvas);
      setRuntimeError(undefined);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : 'Unable to initialize WebGL2');
    }

    return () => rendererRef.current?.destroy();
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const result: ShaderCompileResult = renderer.compile(fragment);
    const snapshot: CompileSnapshot = {
      ok: result.ok,
      log: result.log,
      stats: result.ok ? renderer.measureStats() : undefined,
    };
    onCompile?.(snapshot);
  }, [fragment, onCompile]);

  useImperativeHandle(ref, () => ({
    async captureFrames() {
      const renderer = rendererRef.current;
      return renderer ? captureFrames(renderer) : [];
    },
    measureStats() {
      return rendererRef.current?.measureStats();
    },
  }));

  return (
    <div className="canvasShell">
      <canvas
        ref={canvasRef}
        className="shaderCanvas"
        aria-label="Rendered shader"
        onPointerDown={(event) => {
          pointerDownRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          rendererRef.current?.setMouse(event.clientX, event.clientY, true);
        }}
        onPointerMove={(event) => {
          rendererRef.current?.setMouse(event.clientX, event.clientY, pointerDownRef.current);
        }}
        onPointerUp={(event) => {
          pointerDownRef.current = false;
          rendererRef.current?.setMouse(event.clientX, event.clientY, false);
        }}
        onPointerLeave={(event) => {
          pointerDownRef.current = false;
          rendererRef.current?.setMouse(event.clientX, event.clientY, false);
        }}
      />
      {runtimeError ? <div className="canvasError">{runtimeError}</div> : null}
    </div>
  );
});
