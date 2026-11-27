// useLongPress - 롱프레스 커스텀 훅
// 원형 프로그레스 오버레이용 progress (0~1) 추적

import { useState, useRef, useCallback, useEffect } from 'react';

interface UseLongPressOptions {
  longPressMs: number;
  onComplete: () => void;
  onStart?: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  onProgress?: (progress: number) => void;
  trackProgress?: boolean;
}

interface UseLongPressReturn {
  isPressed: boolean;
  progress: number;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
  };
}

export function useLongPress({
  longPressMs,
  onComplete,
  onStart,
  onCancel,
  disabled = false,
  onProgress,
  trackProgress = true,
}: UseLongPressOptions): UseLongPressReturn {
  const [isPressed, setIsPressed] = useState(false);
  const [progress, setProgress] = useState(0);

  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const completedRef = useRef(false);
  const pressedRef = useRef(false);
  const durationRef = useRef(longPressMs);
  const optionsRef = useRef({ onComplete, onStart, onCancel, disabled, onProgress, trackProgress });
  optionsRef.current = { onComplete, onStart, onCancel, disabled, onProgress, trackProgress };

  const cancel = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const wasPressed = pressedRef.current;
    pressedRef.current = false;
    if (wasPressed && !completedRef.current) optionsRef.current.onCancel?.();
    setIsPressed(false);
    setProgress(0);
    completedRef.current = false;
    if (wasPressed) optionsRef.current.onProgress?.(0);
  }, []);

  const tick = useCallback(() => {
    if (!pressedRef.current) return;
    if (optionsRef.current.disabled) { cancel(); return; }
    const elapsed = performance.now() - startTimeRef.current;
    const p = durationRef.current > 0 ? Math.min(elapsed / durationRef.current, 1) : 1;
    if (optionsRef.current.trackProgress) setProgress(p);
    optionsRef.current.onProgress?.(p);

    if (p >= 1) {
      completedRef.current = true;
      pressedRef.current = false;
      rafRef.current = 0;
      setIsPressed(false);
      setProgress(0);
      optionsRef.current.onComplete();
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [cancel]);

  useEffect(() => { if (disabled) cancel(); }, [disabled, cancel]);
  useEffect(() => () => cancel(), [cancel]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (optionsRef.current.disabled || pressedRef.current) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

      completedRef.current = false;
      pressedRef.current = true;
      durationRef.current = longPressMs;
      startTimeRef.current = performance.now();
      setIsPressed(true);
      setProgress(0);
      optionsRef.current.onStart?.();

      rafRef.current = requestAnimationFrame(tick);
    },
    [longPressMs, tick],
  );

  const handlePointerUp = useCallback(() => cancel(), [cancel]);
  const handlePointerLeave = useCallback(() => cancel(), [cancel]);
  const handlePointerCancel = useCallback(() => cancel(), [cancel]);

  return {
    isPressed,
    progress,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerUp: handlePointerUp,
      onPointerLeave: handlePointerLeave,
      onPointerCancel: handlePointerCancel,
    },
  };
}
