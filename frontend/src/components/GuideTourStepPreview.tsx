import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** 한 단계(phase)에서 강조할 실제 페이지 요소 + 안내 */
export interface TourPhase {
  /** /request 위저드 단계(1~5). 지정 시 해당 단계로 전환 후 강조 */
  wizardStep?: number;
  /** iframe 내부 페이지의 요소 선택자 */
  selector: string;
  /** 설명 캡션 i18n 키 */
  captionKey: string;
}

interface Props {
  /** iframe로 띄울 실제 라우트 (예: '/request') */
  path: string;
  phases: TourPhase[];
  /** 현재 보여지는 단계인지 — true일 때만 오버레이 루프 실행 */
  active: boolean;
  /** 일시정지 여부 — true면 다음 phase로 진행하지 않음 */
  paused: boolean;
}

/** 가상 뷰포트 크기 (실제 페이지를 이 크기로 렌더한 뒤 축소) */
const VIEWPORT_W = 1180;
const VIEWPORT_H = 720;
const HOLD_MS = 3200;
const SCROLL_SETTLE_MS = 320;
const STEP_SWITCH_MS = 750;
const LOOP_DELAY_MS = 1400;
const EL_WAIT_MS = 2600;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const GuideTourStepPreview: React.FC<Props> = ({ path, phases, active, paused }) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [scale, setScale] = useState(0.5);
  const [loaded, setLoaded] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [caption, setCaption] = useState('');

  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // iframe은 한 번만 로드하고 위저드 단계는 postMessage로 전환 (리로드 깜빡임 방지)
  const initialStep = phases.find((p) => p.wizardStep)?.wizardStep ?? 1;
  const src = `${path}?embed=tour&step=${initialStep}`;

  // 컨테이너 너비에 맞춰 축소 비율 계산
  useEffect(() => {
    const update = () => {
      const w = containerRef.current?.clientWidth ?? VIEWPORT_W * 0.5;
      setScale(w / VIEWPORT_W);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // 오버레이 루프
  useEffect(() => {
    if (!active || !loaded || phases.length === 0) return;
    let cancelled = false;

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const wait = async (ms: number): Promise<void> => {
      const tick = 50;
      let elapsed = 0;
      while (elapsed < ms) {
        if (cancelled) return;
        if (pausedRef.current) { await sleep(tick); continue; }
        await sleep(tick);
        elapsed += tick;
      }
    };

    const getDoc = (): Document | null => {
      try {
        return iframeRef.current?.contentDocument ?? null;
      } catch {
        return null;
      }
    };

    const waitForEl = async (selector: string): Promise<HTMLElement | null> => {
      let waited = 0;
      while (waited < EL_WAIT_MS) {
        if (cancelled) return null;
        const el = getDoc()?.querySelector<HTMLElement>(selector) ?? null;
        if (el) return el;
        await sleep(100);
        waited += 100;
      }
      return getDoc()?.querySelector<HTMLElement>(selector) ?? null;
    };

    const switchStep = (wizardStep: number) => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'guide-tour-step', step: wizardStep },
        window.location.origin
      );
    };

    const run = async (): Promise<void> => {
      let currentStep = initialStep;
      // 무한 루프 (취소 시 종료)
      // eslint-disable-next-line no-constant-condition
      while (true) {
        for (const phase of phases) {
          if (cancelled) return;
          setRect(null);

          const ws = phase.wizardStep ?? currentStep;
          if (ws !== currentStep) {
            switchStep(ws);
            currentStep = ws;
            await wait(STEP_SWITCH_MS);
            if (cancelled) return;
          }

          const el = await waitForEl(phase.selector);
          if (cancelled) return;
          if (!el) continue;

          el.scrollIntoView({ block: 'center', inline: 'center' });
          await wait(SCROLL_SETTLE_MS);
          if (cancelled) return;

          const r = el.getBoundingClientRect();
          setRect({
            top: r.top * scale,
            left: r.left * scale,
            width: r.width * scale,
            height: r.height * scale,
          });
          setCaption(t(phase.captionKey as never));
          await wait(HOLD_MS);
        }
        if (cancelled) return;
        await wait(LOOP_DELAY_MS);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [active, loaded, scale, phases, t, initialStep]);

  const cursor = rect ? { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 } : null;

  return (
    <div
      className="guide-tour-preview-frame"
      ref={containerRef}
      style={{ height: VIEWPORT_H * scale }}
    >
      <iframe
        ref={iframeRef}
        className="guide-tour-iframe"
        title={path}
        src={src}
        style={{
          width: VIEWPORT_W,
          height: VIEWPORT_H,
          transform: `scale(${scale})`,
        }}
        onLoad={() => setLoaded(true)}
      />

      {rect && (
        <div
          className="guide-tour-spotlight"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      )}

      {cursor && (
        <div
          className="guide-tour-cursor"
          style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
        >
          <svg width="22" height="22" viewBox="0 0 22 22">
            <path
              d="M2 2 L2 17 L6.2 13 L9 19 L11.4 18 L8.6 12 L14 12 Z"
              fill="#fff"
              stroke="#1a1a2e"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}

      {rect && caption && (
        <div
          className="guide-tour-caption"
          style={{
            top: Math.min(rect.top + rect.height + 8, VIEWPORT_H * scale - 56),
            left: Math.max(8, Math.min(rect.left, VIEWPORT_W * scale - 320)),
          }}
        >
          {caption}
        </div>
      )}

      {!loaded && <div className="guide-tour-preview-loading" />}
    </div>
  );
};

export default GuideTourStepPreview;
