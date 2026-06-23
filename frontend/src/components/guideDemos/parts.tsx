import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { useTranslation } from 'react-i18next';

/** useAnimationControls() 반환 타입 (framer-motion 버전 간 타입명 변동 대응) */
export type DemoCursorControls = ReturnType<typeof useAnimationControls>;

/** 데모 타임라인용 sleep 헬퍼 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** stage 기준 target 요소의 중심 좌표 */
export function getCenter(
  stage: HTMLElement,
  target: HTMLElement
): { x: number; y: number } {
  const s = stage.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  return {
    x: r.left - s.left + r.width / 2,
    y: r.top - s.top + r.height / 2,
  };
}

interface FakeCursorProps {
  controls: DemoCursorControls;
  clicking: boolean;
}

/** 데모 무대 위를 움직이는 가짜 마우스 커서 */
export const FakeCursor: React.FC<FakeCursorProps> = ({ controls, clicking }) => (
  <motion.div className="guide-demo-cursor" animate={controls} initial={{ x: -30, y: -30 }}>
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      className={clicking ? 'clicking' : undefined}
    >
      <path
        d="M2 2 L2 17 L6.2 13 L9 19 L11.4 18 L8.6 12 L14 12 Z"
        fill="#fff"
        stroke="#1a1a2e"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  </motion.div>
);

const CURSOR_MOVE = { duration: 0.72, ease: [0.5, 0.05, 0.2, 1] as const };

/** 데모 타임라인 시퀀스에 전달되는 제어 API */
export interface TimelineApi {
  /** 가짜 커서를 target 요소 중심으로 이동 */
  moveTo: (el: HTMLElement | null) => Promise<void>;
  /** target 위치에 클릭 리플 재생 */
  click: (el: HTMLElement | null) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  /** 언마운트/재시작으로 중단되었는지 여부 */
  cancelled: () => boolean;
}

interface DemoTimeline {
  stageRef: React.RefObject<HTMLDivElement>;
  /** 무대 안에 렌더링할 커서 + 리플 레이어 */
  cursorLayer: React.ReactNode;
  /** 시퀀스 종료(루프 대기) 여부 */
  done: boolean;
  /** 처음부터 다시 재생 */
  replay: () => void;
}

/**
 * 가짜 커서 + 클릭 리플 + 루프 재생을 캡슐화한 데모 타임라인 훅.
 * sequence 콜백 안에서 api.moveTo/click/sleep 으로 연출을 기술한다.
 */
export function useDemoTimeline(
  sequence: (api: TimelineApi) => Promise<void>,
  loopDelayMs = 4000,
  paused = false
): DemoTimeline {
  const stageRef = useRef<HTMLDivElement>(null);
  const cursor = useAnimationControls();
  const [clicking, setClicking] = useState(false);
  const [ripple, setRipple] = useState<{ x: number; y: number; id: number } | null>(null);
  const [done, setDone] = useState(false);
  const [runId, setRunId] = useState(0);
  const seqRef = useRef(sequence);
  seqRef.current = sequence;
  // 일시정지 상태를 ref로 추적 — 재렌더 없이 진행 중인 시퀀스가 즉시 반영
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let cancelled = false;
    let loopTimer: ReturnType<typeof setTimeout> | undefined;

    // paused가 풀릴 때까지 대기 (취소되면 즉시 탈출)
    const waitWhilePaused = async (): Promise<void> => {
      while (pausedRef.current && !cancelled) await sleep(60);
    };
    const moveTo = async (el: HTMLElement | null): Promise<void> => {
      await waitWhilePaused();
      if (!el || !stageRef.current) return;
      const { x, y } = getCenter(stageRef.current, el);
      await cursor.start({ x: x - 6, y: y - 4, transition: CURSOR_MOVE });
    };
    const click = async (el: HTMLElement | null): Promise<void> => {
      await waitWhilePaused();
      if (!el || !stageRef.current) return;
      const { x, y } = getCenter(stageRef.current, el);
      setRipple({ x, y, id: Date.now() });
      setClicking(true);
      await sleep(150);
      setClicking(false);
      await sleep(120);
    };
    // 일시정지 인지 sleep — 대기 전후로 paused면 멈춘다
    const psleep = async (ms: number): Promise<void> => {
      await waitWhilePaused();
      await sleep(ms);
      await waitWhilePaused();
    };
    const api: TimelineApi = { moveTo, click, sleep: psleep, cancelled: () => cancelled };

    const exec = async (): Promise<void> => {
      setDone(false);
      await cursor.start({ x: -30, y: -30, transition: { duration: 0 } });
      await sleep(400);
      if (cancelled) return;
      await seqRef.current(api);
      if (cancelled) return;
      setDone(true);
      loopTimer = setTimeout(() => setRunId((id) => id + 1), loopDelayMs);
    };
    exec();

    return () => {
      cancelled = true;
      if (loopTimer) clearTimeout(loopTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const cursorLayer = (
    <>
      <FakeCursor controls={cursor} clicking={clicking} />
      <AnimatePresence>
        {ripple && (
          <motion.span
            key={ripple.id}
            className="guide-demo-ripple"
            style={{ left: ripple.x - 4, top: ripple.y - 4 }}
            initial={{ opacity: 0.7, scale: 1 }}
            animate={{ opacity: 0, scale: 6 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            onAnimationComplete={() => setRipple(null)}
          />
        )}
      </AnimatePresence>
    </>
  );

  return { stageRef, cursorLayer, done, replay: () => setRunId((id) => id + 1) };
}

interface DemoControlsProps {
  done: boolean;
  onReplay: () => void;
}

/** 데모 하단 공용 컨트롤(다시 보기 + 상태) */
export const DemoControls: React.FC<DemoControlsProps> = ({ done, onReplay }) => {
  const { t } = useTranslation();
  return (
    <div className="guide-demo-controls">
      <button type="button" className="guide-demo-replay" onClick={onReplay}>
        {t('guide.demo.replay')}
      </button>
      <span className="guide-demo-status">
        {done ? t('guide.demo.done_loop') : t('guide.demo.playing')}
      </span>
    </div>
  );
};
