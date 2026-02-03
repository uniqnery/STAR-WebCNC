// useLongPress - 롱프레스 커스텀 훅
// 원형 프로그레스 오버레이용 progress (0~1) 추적

import { useState, useRef, useCallback } from 'react';

interface UseLongPressOptions {
  longPressMs: number;
  onComplete: () => void;
  onStart?: () => void;
  onCancel?: () => void;
  disabled?: boolean;
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
}: UseLongPressOptions): UseLongPressReturn {
  const [isPressed, setIsPressed] = useState(false);
  const [progress, setProgress] = useState(0);

  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const completedRef = useRef(false);

  const cancel = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (isPressed && !completedRef.current) {
      onCancel?.();
    }
    setIsPressed(false);
    setProgress(0);
    completedRef.current = false;
  }, [isPressed, onCancel]);

  const tick = useCallback(() => {
    const elapsed = performance.now() - startTimeRef.current;
    const p = Math.min(elapsed / longPressMs, 1);
    setProgress(p);

    if (p >= 1) {
      completedRef.current = true;
      setIsPressed(false);
      setProgress(0);
      onComplete();
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [longPressMs, onComplete]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

      completedRef.current = false;
      startTimeRef.current = performance.now();
      setIsPressed(true);
      setProgress(0);
      onStart?.();

      rafRef.current = requestAnimationFrame(tick);
    },
    [disabled, tick, onStart],
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
