import React, { useEffect, useRef, useState } from 'react';

/** 한 phase = 위저드 단계 이동(선택) + 명령(선택) + 요소 강조 + 캡션 */
export interface TourPhase {
  /** /request 위저드 단계(1~5). 지정 시 해당 단계로 전환 후 진행 */
  wizardStep?: number;
  /** iframe(투어 모드)로 보낼 명령 (map-* / jayer-anim / oayer-* / bb-* / open-submit / submitted) */
  cmd?: string;
  /** 강조할 요소 선택자 (없으면 캡션만 표시) */
  selector?: string;
  /** 선택자가 없을 때 캡션을 하단에 고정한다 (J-ayer 실시간 데모처럼 표를 가리지 않도록) */
  bottomCaption?: boolean;
  /** 선택자가 없을 때 캡션을 상단에 고정한다 (하단 모달 footer를 가리지 않도록) */
  topCaption?: boolean;
  /** 설명 캡션 (이미 번역된 문자열) */
  caption: string;
  /** 이 phase 표시 시간(ms) */
  hold?: number;
}

interface SeekSignal { index: number; nonce: number; }

interface Props {
  path: string;
  phases: TourPhase[];
  active: boolean;
  paused: boolean;
  onPhaseChange?: (index: number) => void;
  seek?: SeekSignal;
}

const VIEWPORT_W = 1180;
const VIEWPORT_H = 720;
export const DEFAULT_HOLD_MS = 3000;
const SCROLL_SETTLE_MS = 320;
const STEP_SWITCH_MS = 800;
const CMD_LEAD_MS = 900;
const LOOP_DELAY_MS = 1200;
const EL_WAIT_MS = 2600;
// 챕터 되감기(seek) 시 0~타깃 단계를 빠르게 재적용하는 간격
const REPLAY_RESET_MS = 260;
const REPLAY_STEP_MS = 140;
const REPLAY_CMD_MS = 180;
const MAX_PREVIEW_VH = 0.52;
// 스포트라이트가 강조 대상에 너무 딱 붙지 않도록 사방에 두는 여백(축소 후 화면 px)
const SPOTLIGHT_PAD = 14;

interface Rect { top: number; left: number; width: number; height: number; }

const GuideTourStepPreview: React.FC<Props> = ({ path, phases, active, paused, onPhaseChange, seek }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [scale, setScale] = useState(0.5);
  const [loaded, setLoaded] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [caption, setCaption] = useState('');
  const [bottomCaption, setBottomCaption] = useState(false);
  const [topCaption, setTopCaption] = useState(false);
  // 항목이 바뀔 때마다 증가 → 강조/캡션에 부드러운 밝기 페이드인을 다시 재생시키는 키
  const [revealKey, setRevealKey] = useState(0);

  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const onPhaseChangeRef = useRef(onPhaseChange);
  useEffect(() => { onPhaseChangeRef.current = onPhaseChange; }, [onPhaseChange]);

  const seekRef = useRef<number | null>(null);
  useEffect(() => { if (seek) seekRef.current = seek.index; }, [seek?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const initialStep = phases.find((p) => p.wizardStep)?.wizardStep ?? 1;
  const src = `${path}?embed=tour&step=${initialStep}`;

  // 일시정지/재생을 iframe(투어 데모)에도 전달 — iframe 내부 커서/입력 애니메이션도 멈추거나 이어지게 한다.
  useEffect(() => {
    if (!loaded) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'guide-tour-cmd', cmd: paused ? 'pause' : 'resume' },
      window.location.origin,
    );
  }, [paused, loaded]);

  useEffect(() => {
    const update = () => {
      const w = containerRef.current?.parentElement?.clientWidth ?? VIEWPORT_W * 0.5;
      const maxH = window.innerHeight * MAX_PREVIEW_VH;
      setScale(Math.min(w / VIEWPORT_W, maxH / VIEWPORT_H));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (!active || !loaded || phases.length === 0) return;
    let cancelled = false;

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const interrupted = () => cancelled || seekRef.current != null;
    const wait = async (ms: number): Promise<void> => {
      const tick = 50;
      let elapsed = 0;
      while (elapsed < ms) {
        if (interrupted()) return;
        if (pausedRef.current) { await sleep(tick); continue; }
        await sleep(tick);
        elapsed += tick;
      }
    };
    const getDoc = (): Document | null => {
      try { return iframeRef.current?.contentDocument ?? null; } catch { return null; }
    };
    const waitForEl = async (selector: string): Promise<HTMLElement | null> => {
      let waited = 0;
      while (waited < EL_WAIT_MS) {
        if (interrupted()) return null;
        const el = getDoc()?.querySelector<HTMLElement>(selector) ?? null;
        if (el) return el;
        await sleep(100);
        waited += 100;
      }
      return getDoc()?.querySelector<HTMLElement>(selector) ?? null;
    };
    const sendCmd = (payload: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage({ type: 'guide-tour-cmd', ...payload }, window.location.origin);
    };

    // 요청서 단계에서만: 뒤(또는 임의)로 되감을 때 상태를 정확히 복원하기 위해
    // 초기화 후 0~타깃 직전 단계의 명령을 instant(즉시 상태적용)로 재적용한다.
    const isRequest = path === '/request';
    let currentStep = initialStep;
    const replayTo = async (target: number): Promise<boolean> => {
      sendCmd({ cmd: 'reset-all' });
      currentStep = initialStep;
      await sleep(REPLAY_RESET_MS);
      if (cancelled || seekRef.current != null) return false;
      for (let j = 0; j < target; j += 1) {
        if (cancelled || seekRef.current != null) return false;
        const p = phases[j];
        const ws = p.wizardStep ?? currentStep;
        if (ws !== currentStep) {
          sendCmd({ cmd: 'step', step: ws });
          currentStep = ws;
          await sleep(REPLAY_STEP_MS);
          if (cancelled || seekRef.current != null) return false;
        }
        if (p.cmd) {
          sendCmd({ cmd: p.cmd, instant: true });
          await sleep(REPLAY_CMD_MS);
        }
      }
      return true;
    };

    const run = async (): Promise<void> => {
      let i = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (cancelled) return;
        if (seekRef.current != null) {
          i = seekRef.current;
          seekRef.current = null;
          if (isRequest && i > 0) {
            const ok = await replayTo(i);
            if (cancelled) return;
            if (!ok) continue; // 재생 중 새 seek 도착 → 루프 상단에서 다시 처리
          }
        }
        const phase = phases[i];
        onPhaseChangeRef.current?.(i);
        // 전환: 이전 강조/캡션을 비운다 (다음 항목은 천천히 밝아지며 등장)
        setRect(null);
        setCaption('');

        const ws = phase.wizardStep ?? currentStep;
        if (ws !== currentStep) {
          sendCmd({ cmd: 'step', step: ws });
          currentStep = ws;
          await wait(STEP_SWITCH_MS);
          if (cancelled) return;
          if (seekRef.current != null) continue;
        }
        if (phase.cmd) {
          sendCmd({ cmd: phase.cmd });
          await wait(CMD_LEAD_MS);
          if (cancelled) return;
          if (seekRef.current != null) continue;
        }
        if (phase.selector) {
          const el = await waitForEl(phase.selector);
          if (cancelled) return;
          if (seekRef.current != null) continue;
          if (el) {
            // 세로(상/하)만 중앙 정렬 — 가로(좌/우)는 'nearest'로 두어 미리보기가 좌우로 흔들리지 않게 한다.
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            await wait(SCROLL_SETTLE_MS);
            if (cancelled) return;
            if (seekRef.current != null) continue;
            const r = el.getBoundingClientRect();
            setRect({
              top: r.top * scale - SPOTLIGHT_PAD,
              left: r.left * scale - SPOTLIGHT_PAD,
              width: r.width * scale + SPOTLIGHT_PAD * 2,
              height: r.height * scale + SPOTLIGHT_PAD * 2,
            });
          }
        }
        setBottomCaption(!!phase.bottomCaption);
        setTopCaption(!!phase.topCaption);
        setCaption(phase.caption);
        setRevealKey((k) => k + 1);

        await wait(phase.hold ?? DEFAULT_HOLD_MS);
        if (cancelled) return;
        if (seekRef.current != null) continue;

        i += 1;
        if (i >= phases.length) { i = 0; await wait(LOOP_DELAY_MS); if (cancelled) return; }
      }
    };

    run();
    return () => { cancelled = true; };
  }, [active, loaded, scale, phases, initialStep]);

  const cursor = rect ? { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 } : null;
  const frameW = VIEWPORT_W * scale;
  const frameH = VIEWPORT_H * scale;
  const captionPos = rect ? 'anchored' : topCaption ? 'top' : bottomCaption ? 'bottom' : 'center';

  return (
    <div className="guide-tour-preview-frame" ref={containerRef} style={{ width: frameW, height: frameH, margin: '0 auto' }}>
      <iframe
        ref={iframeRef}
        className="guide-tour-iframe"
        title={path}
        src={src}
        style={{ width: VIEWPORT_W, height: VIEWPORT_H, transform: `scale(${scale})` }}
        onLoad={() => setLoaded(true)}
      />

      {rect && (
        <div key={`sp-${revealKey}`} className="guide-tour-spotlight" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />
      )}

      {cursor && (
        <div className="guide-tour-cursor" style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}>
          <svg width="22" height="22" viewBox="0 0 22 22">
            <path d="M2 2 L2 17 L6.2 13 L9 19 L11.4 18 L8.6 12 L14 12 Z" fill="#fff" stroke="#1a1a2e" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </div>
      )}

      {caption && (
        <div
          key={`cap-${revealKey}`}
          className={`guide-tour-caption ${captionPos}`}
          style={captionPos === 'anchored' && rect ? {
            top: Math.min(rect.top + rect.height + 8, frameH - 56),
            left: Math.max(8, Math.min(rect.left, frameW - 320)),
          } : undefined}
        >
          {caption}
        </div>
      )}

      {!loaded && <div className="guide-tour-preview-loading" />}
    </div>
  );
};

export default GuideTourStepPreview;
