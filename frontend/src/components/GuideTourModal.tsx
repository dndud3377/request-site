import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import GuideTourStepPreview, { TourPhase } from './GuideTourStepPreview';

/** "전체 가이드" 한 단계의 메타데이터 */
export interface GuideTourStep {
  key: 'request' | 'approval' | 'history' | 'voc' | 'permission';
  title: string;
  description: string;
  /** iframe으로 그대로 보여줄 실제 라우트 */
  path: string;
  /** 페이지 위에서 순차로 강조할 phase들 */
  phases: TourPhase[];
}

/**
 * 전체 가이드 단계 메타데이터 반환.
 * 현재는 "요청서 작성"(/request) 1개만 구현되어 있으며, 그 안에서 위저드 5단계를
 * 순차 진행하며 핵심 기능을 설명한다. 나머지 단계(결재/이력/VOC/권한)는 추후 확장.
 */
export function useGuideTourSteps(): GuideTourStep[] {
  const { t } = useTranslation();
  // 모달 리렌더(예: 일시정지 토글)마다 배열 식별자가 바뀌면 미리보기 오버레이 루프가
  // 재시작되므로, 언어(t)가 바뀔 때만 새로 생성되도록 메모이즈한다.
  return useMemo(
    () => [
      {
        key: 'request' as const,
        title: t('guide.tour.steps.request.title'),
        description: t('guide.tour.steps.request.description'),
        path: '/request',
        phases: [
          { wizardStep: 1, selector: '.wizard-indicator', captionKey: 'guide.tour.steps.request.flow.wizard' },
          { wizardStep: 1, selector: '[data-tour="detail-fields"]', captionKey: 'guide.tour.steps.request.flow.detail' },
          { wizardStep: 1, selector: '.required', captionKey: 'guide.tour.steps.request.flow.required' },
          { wizardStep: 2, selector: '.guide-badge', captionKey: 'guide.tour.steps.request.flow.map' },
          { wizardStep: 3, selector: '.wizard-table', captionKey: 'guide.tour.steps.request.flow.jayer_auto' },
          { wizardStep: 3, selector: '.th-header-btn', captionKey: 'guide.tour.steps.request.flow.jayer_filter' },
          { wizardStep: 4, selector: '[data-tour="oayer-tabs"]', captionKey: 'guide.tour.steps.request.flow.oayer' },
          { wizardStep: 5, selector: '[data-tour="bb-autofill"]', captionKey: 'guide.tour.steps.request.flow.bb_autofill' },
          { wizardStep: 5, selector: '.bb-split-panel', captionKey: 'guide.tour.steps.request.flow.bb_mapping' },
        ],
      },
    ],
    [t]
  );
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const GuideTourModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const steps = useGuideTourSteps();
  const modalRef = useRef<HTMLDivElement>(null);

  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);

  // 열릴 때마다 첫 단계 / 재생 상태로 초기화
  useEffect(() => {
    if (isOpen) {
      setCurrent(0);
      setPaused(false);
    }
  }, [isOpen]);

  const isFirst = current === 0;
  const isLast = current === steps.length - 1;

  const goPrev = useCallback(() => {
    setPaused(false);
    setCurrent((c) => Math.max(0, c - 1));
  }, []);

  const goNext = useCallback(() => {
    if (isLast) {
      onClose();
      return;
    }
    setPaused(false);
    setCurrent((c) => Math.min(steps.length - 1, c + 1));
  }, [isLast, onClose, steps.length]);

  // Esc 닫기 + Tab 포커스 트랩
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && modalRef.current) {
        const nodes = modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // 열릴 때 모달로 포커스 이동
  useEffect(() => {
    if (isOpen) modalRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const step = steps[current];

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
        <div className="guide-tour-progress">
          {t('guide.tour.progress', { current: current + 1, total: steps.length })}
        </div>

        <div className="guide-tour-preview">
          <GuideTourStepPreview
            key={step.key}
            path={step.path}
            phases={step.phases}
            active
            paused={paused}
          />
        </div>

        <h3 className="guide-tour-title">{step.title}</h3>
        <p className="guide-tour-desc">{step.description}</p>

        <div className="guide-tour-dots">
          {steps.map((s, i) => (
            <span key={s.key} className={`guide-tour-dot${i === current ? ' active' : ''}`} />
          ))}
        </div>

        <div className="guide-tour-footer">
          <button
            type="button"
            className="btn btn-secondary guide-tour-pause"
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? t('guide.tour.resume') : t('guide.tour.pause')}
          </button>

          <div className="guide-tour-nav">
            <button type="button" className="btn btn-secondary" onClick={goPrev} disabled={isFirst}>
              {t('guide.tour.prev')}
            </button>
            <button type="button" className="guide-tour-skip" onClick={onClose}>
              {t('guide.tour.skip')}
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
