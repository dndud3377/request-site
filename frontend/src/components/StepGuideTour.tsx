import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** 하이라이트 가이드 투어의 그룹 하나 — 실제 페이지 위 요소(들)를 강조하고 설명한다. */
export interface StepGuideGroup {
  /** 강조할 요소 선택자(들). 여러 개면 전부를 감싸는 하나의 스포트라이트로 묶어서 그린다. */
  selectors: string[];
  title: string;
  description: string;
  /**
   * 이 그룹이 활성화될 때 실행 — 조건부로만 나타나는 실제 요소를 화면에 드러낸다.
   * (호출 전에 항상 onRestoreBase 가 먼저 실행되므로, 매번 정착된 원본 상태 위에서 시작한다)
   */
  onEnter?: () => void;
}

interface Props {
  isOpen: boolean;
  title: string;
  groups: StepGuideGroup[];
  /** 스텝을 열 때 스냅샷해 둔 원본 상태로 되돌린다 (그룹 이동/닫기 시마다 먼저 호출됨) */
  onRestoreBase: () => void;
  onClose: () => void;
}

interface Rect { top: number; left: number; width: number; height: number; }

const SPOTLIGHT_PAD = 10;
const ENTER_DELAY_MS = 60;
const SETTLE_MS = 220;
const CARD_WIDTH = 340;
const CARD_APPROX_HEIGHT = 160;

const unionRect = (selectors: string[]): Rect | null => {
  const rects = selectors
    .map((s) => { try { return document.querySelector<HTMLElement>(s); } catch { return null; } })
    .filter((el): el is HTMLElement => !!el)
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 || r.height > 0);
  if (rects.length === 0) return null;
  const top = Math.min(...rects.map((r) => r.top));
  const left = Math.min(...rects.map((r) => r.left));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  const right = Math.max(...rects.map((r) => r.right));
  return { top, left, width: right - left, height: bottom - top };
};

const firstElement = (selectors: string[]): HTMLElement | null => {
  for (const s of selectors) {
    try {
      const el = document.querySelector<HTMLElement>(s);
      if (el) return el;
    } catch { /* invalid selector, skip */ }
  }
  return null;
};

const cardPosition = (rect: Rect | null): React.CSSProperties => {
  if (!rect) {
    return { top: '40%', left: '50%', transform: 'translate(-50%, -50%)' };
  }
  const margin = 14;
  let top = rect.top + rect.height + margin;
  if (top + CARD_APPROX_HEIGHT > window.innerHeight - 16) {
    top = rect.top - CARD_APPROX_HEIGHT - margin;
  }
  if (top < 12) top = 12;
  let left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - CARD_WIDTH - 12));
  return { top, left };
};

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const StepGuideTour: React.FC<Props> = ({ isOpen, title, groups, onRestoreBase, onClose }) => {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout>>();
  const settleTimer = useRef<ReturnType<typeof setTimeout>>();

  const group = groups[index];

  const measure = useCallback(() => {
    const g = groups[index];
    if (!g) return;
    const r = unionRect(g.selectors);
    setRect(
      r
        ? {
            top: r.top - SPOTLIGHT_PAD,
            left: r.left - SPOTLIGHT_PAD,
            width: r.width + SPOTLIGHT_PAD * 2,
            height: r.height + SPOTLIGHT_PAD * 2,
          }
        : null
    );
  }, [groups, index]);

  const enter = useCallback((i: number) => {
    onRestoreBase();
    const g = groups[i];
    g?.onEnter?.();
    setVisible(false);
    setRect(null);
    clearTimeout(enterTimer.current);
    clearTimeout(settleTimer.current);
    enterTimer.current = setTimeout(() => {
      const el = g ? firstElement(g.selectors) : null;
      el?.scrollIntoView({ block: 'center', inline: 'nearest' });
      settleTimer.current = setTimeout(() => {
        const r = g ? unionRect(g.selectors) : null;
        setRect(
          r
            ? {
                top: r.top - SPOTLIGHT_PAD,
                left: r.left - SPOTLIGHT_PAD,
                width: r.width + SPOTLIGHT_PAD * 2,
                height: r.height + SPOTLIGHT_PAD * 2,
              }
            : null
        );
        setVisible(true);
      }, SETTLE_MS);
    }, ENTER_DELAY_MS);
  }, [groups, onRestoreBase]);

  useEffect(() => {
    if (!isOpen) return;
    setIndex(0);
    enter(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [isOpen, measure]);

  useEffect(() => () => {
    clearTimeout(enterTimer.current);
    clearTimeout(settleTimer.current);
  }, []);

  const handleClose = useCallback(() => {
    onRestoreBase();
    onClose();
  }, [onRestoreBase, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { handleClose(); return; }
      if (e.key === 'Tab' && rootRef.current) {
        const nodes = rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, handleClose]);

  useEffect(() => { if (isOpen) rootRef.current?.focus(); }, [isOpen]);

  const goNext = () => {
    if (index >= groups.length - 1) { handleClose(); return; }
    const next = index + 1;
    setIndex(next);
    enter(next);
  };
  const goPrev = () => {
    if (index === 0) return;
    const prev = index - 1;
    setIndex(prev);
    enter(prev);
  };

  if (!isOpen || !group) return null;

  return (
    <div className="step-guide-tour-overlay" onClick={handleClose} role="presentation">
      <div
        ref={rootRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {rect && (
          <div
            className={`step-guide-tour-spotlight${visible ? ' show' : ''}`}
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          />
        )}
        <div
          className={`step-guide-tour-card${visible ? ' show' : ''}`}
          style={{ ...cardPosition(rect), width: CARD_WIDTH }}
        >
          <div className="step-guide-tour-card-head">
            <span className="step-guide-tour-idx">{index + 1} / {groups.length}</span>
            <button
              type="button"
              className="step-guide-tour-close"
              onClick={handleClose}
              aria-label={t('common.close')}
            >
              ✕
            </button>
          </div>
          <h4>{group.title}</h4>
          <p>{group.description}</p>
          <div className="step-guide-tour-foot">
            <div className="step-guide-tour-dots">
              {groups.map((_, i) => (
                <span key={i} className={i === index ? 'on' : ''} />
              ))}
            </div>
            <div className="step-guide-tour-nav">
              <button type="button" className="btn btn-secondary" onClick={goPrev} disabled={index === 0}>
                {t('guide.tour.prev')}
              </button>
              <button type="button" className="btn btn-primary" onClick={goNext}>
                {index === groups.length - 1 ? t('guide.tour.step.done') : t('guide.tour.next')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StepGuideTour;
