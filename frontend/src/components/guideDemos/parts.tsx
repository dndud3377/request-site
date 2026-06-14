import React from 'react';
import { motion, useAnimationControls } from 'framer-motion';

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
