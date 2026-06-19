import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** 한 단계에서 강조할 실제 페이지 요소 */
export interface TourHighlight {
  /** iframe 내부 페이지의 요소 선택자 */
  selector: string;
  /** 설명 캡션 i18n 키 */
  captionKey: string;
}

interface Props {
  /** iframe로 띄울 실제 라우트 (예: '/request') */
  path: string;
  highlights: TourHighlight[];
  /** 현재 보여지는 단계인지 — true일 때만 오버레이 루프 실행 */
  active: boolean;
  /** 일시정지 여부 — true면 다음 하이라이트로 진행하지 않음 */
  paused: boolean;
}

/** 가상 뷰포트 크기 (실제 페이지를 이 크기로 렌더한 뒤 축소) */
const VIEWPORT_W = 1180;
const VIEWPORT_H = 760;
const HOLD_MS = 2400;
const SCROLL_SETTLE_MS = 280;
const LOOP_DELAY_MS = 1200;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const GuideTourStepPreview: React.FC<Props> = ({ path, highlights, active, paused }) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [scale, setScale] = useState(0.45);
  const [loaded, setLoaded] = useState(false);
  const [runId, setRunId] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [caption, setCaption] = useState('');

  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // 컨테이너 너비에 맞춰 축소 비율 계산
  useEffect(() => {
    const update = () => {
      const w = containerRef.current?.clientWidth ?? VIEWPORT_W * 0.45;
      setScale(w / VIEWPORT_W);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // 오버레이 루프
  useEffect(() => {
    if (!active || !loaded || highlights.length === 0) return;
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

    const run = async (): Promise<void> => {
      setRect(null);
      setCaption('');
      await wait(400);
      if (cancelled) return;

      const doc = getDoc();
      if (!doc) return;

      for (const hl of highlights) {
        if (cancelled) return;
        const el = doc.querySelector<HTMLElement>(hl.selector);
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
        setCaption(t(hl.captionKey as never));
        await wait(HOLD_MS);
      }

      if (cancelled) return;
      setTimeout(() => { if (!cancelled) setRunId((id) => id + 1); }, LOOP_DELAY_MS);
    };

    run();
    return () => { cancelled = true; };
  }, [active, loaded, runId, scale, highlights, t]);

  const src = `${path}${path.includes('?') ? '&' : '?'}embed=tour`;

  // 커서는 강조 영역의 좌상단 근처를 가리킴
  const cursor = rect ? { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 } : null;

  return (
    <div
      className="guide-tour-preview-frame"
      ref={containerRef}
      style={{ height: VIEWPORT_H * scale }}
    >
      <iframe
        key={path}
        ref={iframeRef}
        className="guide-tour-iframe"
        title={path}
        src={src}
        style={{
          width: VIEWPORT_W,
          height: VIEWPORT_H,
          transform: `scale(${scale})`,
        }}
        onLoad={() => { setLoaded(true); setRunId((id) => id + 1); }}
      />

      {/* 강조 스포트라이트 + 테두리 */}
      {rect && (
        <div
          className="guide-tour-spotlight"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      )}

      {/* 가짜 커서 */}
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

      {/* 설명 캡션 */}
      {rect && caption && (
        <div
          className="guide-tour-caption"
          style={{ top: Math.min(rect.top + rect.height + 8, VIEWPORT_H * scale - 48), left: rect.left }}
        >
          {caption}
        </div>
      )}

      {!loaded && <div className="guide-tour-preview-loading" />}
    </div>
  );
};

export default GuideTourStepPreview;
