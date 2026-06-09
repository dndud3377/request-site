import { useEffect, useRef, useCallback } from 'react';

const IDLE_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove',
  'keydown',
  'mousedown',
  'scroll',
  'touchstart',
];

interface IdleTimerOptions {
  onWarn?: () => void;
  warnBeforeMs?: number;
  enabled?: boolean;
}

/**
 * 일정 시간 동안 사용자 활동이 없으면 onIdle 콜백을 호출한다.
 * onWarn + warnBeforeMs를 지정하면 만료 전 미리 경고를 보낼 수 있다.
 *
 * @returns reset - 타이머를 즉시 리셋하는 함수 (세션 연장 등에 사용)
 */
export function useIdleTimer(
  onIdle: () => void,
  idleMs: number,
  options: IdleTimerOptions = {},
): { reset: () => void } {
  const { onWarn, warnBeforeMs = 0, enabled = true } = options;

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdleRef = useRef(onIdle);
  const onWarnRef = useRef(onWarn);

  useEffect(() => { onIdleRef.current = onIdle; }, [onIdle]);
  useEffect(() => { onWarnRef.current = onWarn; }, [onWarn]);

  const reset = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);

    if (onWarnRef.current && warnBeforeMs > 0) {
      const warnDelay = idleMs - warnBeforeMs;
      if (warnDelay > 0) {
        warnTimerRef.current = setTimeout(() => {
          onWarnRef.current?.();
        }, warnDelay);
      }
    }

    idleTimerRef.current = setTimeout(() => {
      onIdleRef.current();
    }, idleMs);
  }, [idleMs, warnBeforeMs]);

  useEffect(() => {
    if (!enabled) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
      return;
    }

    reset();

    IDLE_EVENTS.forEach((event) =>
      window.addEventListener(event, reset, { passive: true })
    );

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
      IDLE_EVENTS.forEach((event) =>
        window.removeEventListener(event, reset)
      );
    };
  }, [enabled, reset]);

  return { reset };
}
