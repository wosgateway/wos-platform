// src/components/partner/SignatureCanvas.tsx
//
// Plain <canvas> signature pad — deliberately not the react-signature-
// canvas package from the dev brief. Nothing else in this repo pulls in
// a signature-drawing dependency, and the actual surface area needed
// (pointer-driven strokes + export to PNG) is ~80 lines of native
// Canvas API, matching this codebase's existing preference for a direct
// fetch/native-API implementation over a new dependency (see
// order-notify.ts's header comment on why it calls Telegram/LINE HTTP
// APIs directly instead of adding their SDKs).
//
// Uses Pointer Events (not separate mouse/touch handlers) — one code
// path covers mouse, touch, and stylus.

'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface SignatureCanvasHandle {
  clear: () => void;
  isEmpty: () => boolean;
  /** Returns a base64 PNG (no data: prefix) of the current strokes, cropped to the pad's own dimensions. */
  toPngBase64: () => string;
}

export const SignatureCanvas = forwardRef<SignatureCanvasHandle, { height?: number }>(
  function SignatureCanvas({ height = 180 }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const hasStrokeRef = useRef(false);
    const [isEmptyState, setIsEmptyState] = useState(true);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Render at devicePixelRatio for crisp strokes, but keep the CSS
      // size (and therefore coordinate math below) in logical pixels.
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0b1e3d';
    }, []);

    function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      canvas.setPointerCapture(e.pointerId);
      drawingRef.current = true;
      const { x, y } = getPos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    }

    function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
      if (!drawingRef.current) return;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      const { x, y } = getPos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      if (!hasStrokeRef.current) {
        hasStrokeRef.current = true;
        setIsEmptyState(false);
      }
    }

    function handlePointerUp() {
      drawingRef.current = false;
    }

    useImperativeHandle(ref, () => ({
      clear() {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasStrokeRef.current = false;
        setIsEmptyState(true);
      },
      isEmpty() {
        return !hasStrokeRef.current;
      },
      toPngBase64() {
        const canvas = canvasRef.current;
        if (!canvas) return '';
        return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
      },
    }));

    return (
      <div className="space-y-2">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height, touchAction: 'none' }}
          className="rounded-xl border-2 border-dashed border-slate-300 bg-white cursor-crosshair"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>{isEmptyState ? 'จรดลายเซ็นในกรอบด้านบน' : '✅ มีลายเซ็นแล้ว'}</span>
        </div>
      </div>
    );
  }
);
