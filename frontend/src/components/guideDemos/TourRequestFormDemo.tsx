import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnimationControls } from 'framer-motion';
import { FakeCursor, getCenter, sleep } from './parts';

/**
 * "전체 가이드" 1단계 — 요청서 작성 데모.
 * 실제 요청서 페이지의 마크업/스타일(guide-demo-* 클래스)을 본떠
 * 유형 선택 → 제목/내용 타이핑 → 상신 → 제출 완료 토스트 순서를 루프 재생한다.
 *
 * - active === true 일 때만 애니메이션 루프를 실행하고, false가 되면 정리한다.
 * - paused === true 인 동안에는 다음 시퀀스로 진행하지 않고 현재 상태를 유지한다.
 */
interface Props {
  active: boolean;
  paused: boolean;
}

const TYPE_SPEED_MS = 60;
const LOOP_DELAY_MS = 2600;
const CURSOR_MOVE = { duration: 0.7, ease: [0.5, 0.05, 0.2, 1] as const };

const TourRequestFormDemo: React.FC<Props> = ({ active, paused }) => {
  const { t } = useTranslation();

  const stageRef = useRef<HTMLDivElement>(null);
  const typeRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  const cursor = useAnimationControls();
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const [clicking, setClicking] = useState(false);
  const [field, setField] = useState<'type' | 'title' | 'content' | null>(null);
  const [typeVal, setTypeVal] = useState('');
  const [titleVal, setTitleVal] = useState('');
  const [contentVal, setContentVal] = useState('');
  const [pulse, setPulse] = useState(false);
  const [toast, setToast] = useState(false);
  const [runId, setRunId] = useState(0);

  const typeValue = t('guide.tour.steps.request.demo.type_value');
  const titleValue = t('guide.tour.steps.request.demo.title_value');
  const contentValue = t('guide.tour.steps.request.demo.content_value');

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let loopTimer: ReturnType<typeof setTimeout> | undefined;

    /** 취소·일시정지를 반영하는 대기 (paused 동안 진행 멈춤) */
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

    const moveTo = async (el: HTMLElement | null): Promise<void> => {
      if (!el || !stageRef.current) return;
      const { x, y } = getCenter(stageRef.current, el);
      await cursor.start({ x: x - 6, y: y - 4, transition: CURSOR_MOVE });
    };

    const click = async (): Promise<void> => {
      setClicking(true);
      await wait(150);
      setClicking(false);
      await wait(120);
    };

    const type = async (
      full: string,
      setter: (v: string) => void
    ): Promise<void> => {
      for (let i = 0; i < full.length; i += 1) {
        if (cancelled) return;
        await wait(TYPE_SPEED_MS);
        if (cancelled) return;
        setter(full.slice(0, i + 1));
      }
    };

    const run = async (): Promise<void> => {
      // reset
      setField(null);
      setTypeVal('');
      setTitleVal('');
      setContentVal('');
      setPulse(false);
      setToast(false);
      await cursor.start({ x: -30, y: -30, transition: { duration: 0 } });
      await wait(500);
      if (cancelled) return;

      // 1. 유형 선택
      setField('type');
      await moveTo(typeRef.current);
      if (cancelled) return;
      await click();
      setTypeVal(typeValue);
      await wait(450);
      if (cancelled) return;

      // 2. 제목 타이핑
      setField('title');
      await moveTo(titleRef.current);
      if (cancelled) return;
      await click();
      await type(titleValue, setTitleVal);
      await wait(350);
      if (cancelled) return;

      // 3. 내용 타이핑
      setField('content');
      await moveTo(contentRef.current);
      if (cancelled) return;
      await click();
      await type(contentValue, setContentVal);
      await wait(400);
      if (cancelled) return;

      // 4. 상신 버튼 클릭
      setField(null);
      await moveTo(submitRef.current);
      if (cancelled) return;
      setPulse(true);
      await click();
      setPulse(false);
      if (cancelled) return;

      // 5. 제출 완료 토스트
      setToast(true);
      await wait(900);
      if (cancelled) return;

      loopTimer = setTimeout(() => setRunId((id) => id + 1), LOOP_DELAY_MS);
    };

    run();
    return () => {
      cancelled = true;
      if (loopTimer) clearTimeout(loopTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, runId, cursor]);

  const placeholder = t('request.select_placeholder');

  return (
    <div>
      <div className="guide-demo-stage" ref={stageRef}>
        {/* 유형 */}
        <div className={`guide-demo-field${field === 'type' ? ' active' : ''}${typeVal ? ' filled done' : ''}`}>
          <div className="guide-demo-field-label">
            <span className="step-dot">1</span>
            {t('guide.tour.steps.request.demo.type_label')}
          </div>
          <div className="guide-demo-control" ref={typeRef}>
            <span className={`guide-demo-val${typeVal ? ' filled' : ''}`}>
              {typeVal || placeholder}
            </span>
            <span className="guide-demo-caret">▾</span>
          </div>
        </div>

        {/* 제목 */}
        <div className={`guide-demo-field${field === 'title' ? ' active' : ''}${titleVal ? ' filled done' : ''}`}>
          <div className="guide-demo-field-label">
            <span className="step-dot">2</span>
            {t('guide.tour.steps.request.demo.title_label')}
          </div>
          <div className="guide-demo-control" ref={titleRef}>
            <span className={`guide-demo-val${titleVal ? ' filled' : ''}`}>
              {titleVal || placeholder}
            </span>
            {field === 'title' && <span className="guide-demo-cursorbar" />}
          </div>
        </div>

        {/* 내용 */}
        <div className={`guide-demo-field${field === 'content' ? ' active' : ''}${contentVal ? ' filled done' : ''}`}>
          <div className="guide-demo-field-label">
            <span className="step-dot">3</span>
            {t('guide.tour.steps.request.demo.content_label')}
          </div>
          <div className="guide-demo-control guide-demo-textarea" ref={contentRef}>
            <span className={`guide-demo-val${contentVal ? ' filled' : ''}`}>
              {contentVal || placeholder}
            </span>
            {field === 'content' && <span className="guide-demo-cursorbar" />}
          </div>
        </div>

        {/* 상신 버튼 */}
        <div className="guide-demo-submit-row">
          <button
            type="button"
            className={`guide-demo-submit${pulse ? ' pulse' : ''}`}
            ref={submitRef}
            tabIndex={-1}
          >
            {t('request.submit')}
          </button>
        </div>

        {/* 제출 완료 토스트 */}
        {toast && (
          <div className="guide-demo-toast">
            {t('guide.tour.steps.request.demo.toast')}
          </div>
        )}

        <FakeCursor controls={cursor} clicking={clicking} />
      </div>
    </div>
  );
};

export default TourRequestFormDemo;
