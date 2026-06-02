import { useEffect, useRef } from 'react';

const IDLE_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove',
  'keydown',
  'mousedown',
  'scroll',
  'touchstart',
];

/**
 * 일정 시간 동안 사용자 활동이 없으면 onSave 콜백을 호출한다.
 * @param onSave - 자동저장 실행 함수
 * @param idleMs - 비활동 기준 시간 (밀리초), 기본값 20분
 * @param enabled - false이면 타이머를 등록하지 않는다
 */
export function useIdleAutoSave(
  onSave: () => void,
  idleMs: number = 20 * 60 * 1000,
  enabled: boolean = true,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);

  // 최신 콜백을 ref에 유지 (stale closure 방지)
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (!enabled) return;

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onSaveRef.current();
      }, idleMs);
    };

    reset(); // 마운트 시점부터 타이머 시작

    IDLE_EVENTS.forEach((event) => window.addEventListener(event, reset, { passive: true }));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      IDLE_EVENTS.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [idleMs, enabled]);
}
