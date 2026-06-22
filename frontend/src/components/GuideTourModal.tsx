import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import GuideTourStepPreview, { TourPhase, DEFAULT_HOLD_MS } from './GuideTourStepPreview';

/** "전체 가이드" 한 단계의 메타데이터 */
export interface GuideTourStep {
  key: 'request' | 'approval' | 'history' | 'voc' | 'permission';
  title: string;
  description: string;
  path: string;
  phases: TourPhase[];
}

const RK = 'guide.tour.steps.request.flow';
const AK = 'guide.tour.steps.approval.flow';

/**
 * 전체 가이드 단계 메타데이터. 현재 "요청서 작성"(/request) 1개 — 위저드 5단계를
 * 순차 진행하며 핵심 기능을 실제 동작으로 시연한다.
 */
export function useGuideTourSteps(): GuideTourStep[] {
  const { t } = useTranslation();
  return useMemo(() => {
    const cap = (k: string) => t(`${RK}.${k}` as never) as string;
    const acap = (k: string) => t(`${AK}.${k}` as never) as string;
    const intro = (nameKey: string) =>
      t(`${RK}.step_intro` as never, { step: t(nameKey as never) }) as string;
    return [
      {
        key: 'request' as const,
        title: t('guide.tour.steps.request.title'),
        description: t('guide.tour.steps.request.description'),
        path: '/request',
        phases: [
          // Step 1 — 의뢰 상세
          { wizardStep: 1, selector: '.wizard-indicator', caption: cap('wizard'), hold: 3000 },
          { wizardStep: 1, selector: '[data-tour="line-fields"]', caption: cap('detail'), hold: 3500 },
          { wizardStep: 1, selector: '.required', caption: cap('required'), hold: 3000 },
          // Step 2 — MAP 정보
          { wizardStep: 2, selector: '.wizard-step[data-step="2"]', caption: intro('request.section_map'), hold: 2300 },
          { wizardStep: 2, cmd: 'map-reset', selector: '[data-tour="map-purpose"]', caption: cap('map_purpose'), hold: 3200 },
          { wizardStep: 2, selector: '[data-tour="map-cfamily"]', caption: cap('map_cfamily'), hold: 4200 },
          { wizardStep: 2, cmd: 'map-deviation', selector: '[data-tour="map-deviation"]', caption: cap('map_deviation'), hold: 3500 },
          { wizardStep: 2, cmd: 'map-exception', selector: '[data-tour="map-exception"]', caption: cap('map_exception'), hold: 3200 },
          { wizardStep: 2, cmd: 'map-xmark', selector: '[data-tour="map-xmark"]', caption: cap('map_xmark_photo'), hold: 3800 },
          { wizardStep: 2, selector: '.guide-badge', caption: cap('map'), hold: 3000 },
          // Step 3 — J-ayer
          { wizardStep: 3, selector: '.wizard-step[data-step="3"]', caption: intro('request.job_li'), hold: 2300 },
          { wizardStep: 3, cmd: 'jayer-anim', bottomCaption: true, caption: cap('jayer_auto'), hold: 10000 },
          { wizardStep: 3, selector: '[data-tour="jayer-filter"]', caption: cap('jayer_filter'), hold: 3000 },
          // Step 4 — O-ayer
          { wizardStep: 4, selector: '.wizard-step[data-step="4"]', caption: intro('request.ovl_li'), hold: 2300 },
          { wizardStep: 4, cmd: 'oayer-table', selector: '[data-tour="oayer-tabs"]', caption: cap('oayer'), hold: 3000 },
          { wizardStep: 4, cmd: 'oayer-info', selector: '[data-tour="oayer-info-tbvtlv"]', caption: cap('oayer_info_tbvtlv'), hold: 4200 },
          // Step 5 — 뼈찜(BB)
          { wizardStep: 5, selector: '.wizard-step[data-step="5"]', caption: intro('request.bb_li'), hold: 2300 },
          { wizardStep: 5, cmd: 'bb-autofill-open', selector: '[data-tour="bb-autofill"]', caption: cap('bb_autofill'), hold: 4000 },
          { wizardStep: 5, cmd: 'bb-autofill-apply', bottomCaption: true, caption: cap('bb_autofill_apply'), hold: 5500 },
          { wizardStep: 5, cmd: 'bb-mapping', bottomCaption: true, caption: cap('bb_mapping'), hold: 9000 },
          { wizardStep: 5, cmd: 'open-submit', selector: '[data-tour="submit-fields"]', caption: cap('submit_combined'), hold: 4200 },
          { wizardStep: 5, cmd: 'submitted', caption: cap('submitted'), hold: 3200 },
        ],
      },
      {
        key: 'approval' as const,
        title: t('guide.tour.steps.approval.title'),
        description: t('guide.tour.steps.approval.description'),
        path: '/approval',
        phases: [
          { cmd: 'tour-reset', selector: '.filter-tabs', caption: acap('intro'), hold: 3200 },
          { selector: '[data-tour="approval-route"]', caption: acap('route'), hold: 6500 },
          { cmd: 'my-filter', selector: '[data-tour="approval-my-tab"]', caption: acap('my_filter'), hold: 5000 },
          { cmd: 'open-detail', bottomCaption: true, caption: acap('open_detail'), hold: 6000 },
          { cmd: 'page-jayer', selector: '[data-tour="export-jayer"]', caption: acap('export_jayer'), hold: 4500 },
          { cmd: 'page-route', selector: '[data-tour="approval-route-tab"]', caption: acap('route_tab'), hold: 6500 },
        ],
      },
    ];
  }, [t]);
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const fmt = (ms: number): string => {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const GuideTourModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const steps = useGuideTourSteps();
  const modalRef = useRef<HTMLDivElement>(null);

  const [current, setCurrent] = useState(0);          // step index
  const [paused, setPaused] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(0);        // 현재 phase index
  const [phaseElapsed, setPhaseElapsed] = useState(0);
  const [seekSig, setSeekSig] = useState<{ index: number; nonce: number }>({ index: 0, nonce: 0 });

  const step = steps[current];
  const durations = useMemo(() => step.phases.map((p) => p.hold ?? DEFAULT_HOLD_MS), [step]);
  const totalMs = useMemo(() => durations.reduce((a, b) => a + b, 0), [durations]);
  const baseMs = durations.slice(0, phaseIdx).reduce((a, b) => a + b, 0);
  const elapsedMs = baseMs + Math.min(phaseElapsed, durations[phaseIdx] ?? 0);

  useEffect(() => {
    if (isOpen) {
      setCurrent(0);
      setPaused(false);
      setPhaseIdx(0);
      setPhaseElapsed(0);
      setSeekSig({ index: 0, nonce: 0 });
    }
  }, [isOpen]);

  // 현재 phase 내 경과 시간 틱 (일시정지 시 정지)
  useEffect(() => { setPhaseElapsed(0); }, [phaseIdx]);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setPhaseElapsed((e) => e + 100), 100);
    return () => clearInterval(id);
  }, [paused, phaseIdx]);

  const handlePhaseChange = useCallback((i: number) => setPhaseIdx(i), []);
  const seekTo = useCallback((i: number) => {
    setSeekSig((s) => ({ index: i, nonce: s.nonce + 1 }));
    setPhaseIdx(i);
    setPhaseElapsed(0);
  }, []);

  const isFirst = current === 0;
  const isLast = current === steps.length - 1;

  const goPrev = useCallback(() => { setPaused(false); setCurrent((c) => Math.max(0, c - 1)); }, []);
  const goNext = useCallback(() => {
    if (isLast) { onClose(); return; }
    setPaused(false);
    setCurrent((c) => Math.min(steps.length - 1, c + 1));
  }, [isLast, onClose, steps.length]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Tab' && modalRef.current) {
        const nodes = modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  useEffect(() => { if (isOpen) modalRef.current?.focus(); }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="guide-tour-overlay" onClick={onClose} role="presentation">
      <div
        className="guide-tour-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('guide.tour.heading')}
        tabIndex={-1}
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="guide-tour-close"
          onClick={onClose}
          aria-label={t('guide.tour.close')}
        >
          ✕
        </button>

        <div className="guide-tour-progress">
          {t('guide.tour.progress', { current: current + 1, total: steps.length })} · {step.title}
        </div>

        <div className="guide-tour-preview">
          <GuideTourStepPreview
            key={step.key}
            path={step.path}
            phases={step.phases}
            active
            paused={paused}
            onPhaseChange={handlePhaseChange}
            seek={seekSig}
          />
        </div>

        {/* 동영상형 챕터 타임라인 */}
        <div className="guide-tour-timeline">
          <span className="guide-tour-time">{fmt(elapsedMs)}</span>
          <div className="guide-tour-track">
            {step.phases.map((p, i) => {
              const fill = i < phaseIdx ? 1 : i > phaseIdx ? 0 : Math.min(phaseElapsed / (durations[i] || 1), 1);
              return (
                <button
                  key={i}
                  type="button"
                  className={`guide-tour-chapter${i === phaseIdx ? ' active' : ''}`}
                  style={{ flexGrow: durations[i] }}
                  onClick={() => seekTo(i)}
                  title={p.caption}
                  aria-label={p.caption}
                >
                  <span className="guide-tour-chapter-fill" style={{ width: `${fill * 100}%` }} />
                </button>
              );
            })}
          </div>
          <span className="guide-tour-time">{fmt(totalMs)}</span>
        </div>

        <p className="guide-tour-desc">{step.description}</p>

        <div className="guide-tour-footer">
          <button type="button" className="btn btn-secondary guide-tour-pause" onClick={() => setPaused((p) => !p)}>
            {paused ? t('guide.tour.resume') : t('guide.tour.pause')}
          </button>

          <div className="guide-tour-nav">
            <button type="button" className="btn btn-secondary" onClick={goPrev} disabled={isFirst}>
              {t('guide.tour.prev')}
            </button>
            <button type="button" className="btn btn-primary" onClick={goNext}>
              {isLast ? t('guide.tour.start') : t('guide.tour.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GuideTourModal;
