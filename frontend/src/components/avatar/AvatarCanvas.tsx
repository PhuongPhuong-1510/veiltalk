import { useEffect, useRef } from "react";
import { AvatarRenderer, type AvatarRendererOptions } from "../../lib/avatar-renderer/avatarRenderer";

export interface AvatarCanvasProps {
  className?: string;
  options?: AvatarRendererOptions;
  onReady?: (renderer: AvatarRenderer) => void;
  onDispose?: () => void;
  onError?: (error: Error) => void;
}

/** React chỉ sở hữu DOM/lifecycle; realtime pose đi thẳng qua AvatarRenderer. */
export function AvatarCanvas({ className, options, onReady, onDispose, onError }: AvatarCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readyRef = useRef(onReady); const disposeRef = useRef(onDispose);
  const errorRef = useRef(onError);
  readyRef.current = onReady; disposeRef.current = onDispose; errorRef.current = onError;

  const optionsRef = useRef(options); optionsRef.current = options;
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    let renderer: AvatarRenderer;
    try { renderer = new AvatarRenderer(canvas, optionsRef.current); }
    catch (reason) {
      errorRef.current?.(reason instanceof Error ? reason : new Error("Không thể khởi tạo WebGL renderer."));
      return;
    }
    const observer = new ResizeObserver(([entry]) => renderer.resize(entry.contentRect.width, entry.contentRect.height));
    observer.observe(canvas); renderer.start(); readyRef.current?.(renderer);
    return () => { observer.disconnect(); renderer.dispose(); disposeRef.current?.(); };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-label="Avatar 3D canvas" />;
}
