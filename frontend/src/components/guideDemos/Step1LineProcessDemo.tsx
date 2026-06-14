import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { FakeCursor, getCenter, sleep } from './parts';

type FieldKey = 'line' | 'proc' | 'part' | 'recipe';

interface FieldSpec {
  /** 자동완성 입력창에 타이핑되는 글자 (드롭다운 방식이면 빈 문자열) */
  typed: string;
  /** 최종 선택되는 값 */
  value: string;
  /** 드롭다운 후보 목록 */
  options: string[];
  /** 라벨 i18n 키 (기존 request.* 재사용) */
  labelKey: string;
}

const FIELD_ORDER: FieldKey[] = ['line', 'proc', 'part', 'recipe'];

const FIELDS: Record<FieldKey, FieldSpec> = {
  line:   { typed: '',        value: 'L1',        options: ['L1', 'L2', 'L3'],          labelKey: 'request.line' },
  proc:   { typed: 'RECIPE_', value: 'RECIPE_A1', options: ['RECIPE_A1', 'RECIPE_A2'],  labelKey: 'request.process_selection' },
  part:   { typed: 'PART_',   value: 'PART_1234', options: ['PART_1234', 'PART_1290'],  labelKey: 'request.partid_selection' },
  recipe: { typed: 'PROC_',   value: 'PROC_X1',   options: ['PROC_X1', 'PROC_X2'],      labelKey: 'request.process_id' },
};

const CURSOR_MOVE = { duration: 0.72, ease: [0.5, 0.05, 0.2, 1] as const };
const LOOP_DELAY_MS = 4500;
const TYPE_SPEED_MS = 105;

const Step1LineProcessDemo: React.FC = () => {
  const { t } = useTranslation();

  const stageRef = useRef<HTMLDivElement>(null);
  const downstreamRef = useRef<HTMLDivElement>(null);
  const ctrlRefs: Record<FieldKey, React.RefObject<HTMLDivElement>> = {
    line: useRef<HTMLDivElement>(null),
    proc: useRef<HTMLDivElement>(null),
    part: useRef<HTMLDivElement>(null),
    recipe: useRef<HTMLDivElement>(null),
  };
  const optRefs: Record<FieldKey, React.RefObject<HTMLDivElement>> = {
    line: useRef<HTMLDivElement>(null),
    proc: useRef<HTMLDivElement>(null),
    part: useRef<HTMLDivElement>(null),
    recipe: useRef<HTMLDivElement>(null),
  };

  const cursor = useAnimationControls();
  const [clicking, setClicking] = useState(false);
  const [ripple, setRipple] = useState<{ x: number; y: number; id: number } | null>(null);
  const [vals, setVals] = useState<Record<FieldKey, string | null>>({
    line: null, proc: null, part: null, recipe: null,
  });
  const [active, setActive] = useState<FieldKey | null>(null);
  const [open, setOpen] = useState<FieldKey | null>(null);
  const [typed, setTyped] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [done, setDone] = useState(false);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let loopTimer: ReturnType<typeof setTimeout> | undefined;

    const moveTo = async (el: HTMLElement | null): Promise<void> => {
      if (!el || !stageRef.current) return;
      const { x, y } = getCenter(stageRef.current, el);
      await cursor.start({ x: x - 6, y: y - 4, transition: CURSOR_MOVE });
    };

    const click = async (el: HTMLElement | null): Promise<void> => {
      if (!el || !stageRef.current) return;
      const { x, y } = getCenter(stageRef.current, el);
      setRipple({ x, y, id: Date.now() });
      setClicking(true);
      await sleep(150);
      setClicking(false);
      await sleep(120);
    };

    const fillField = async (field: FieldKey): Promise<boolean> => {
      const spec = FIELDS[field];
      setActive(field);
      await moveTo(ctrlRefs[field].current);
      if (cancelled) return false;
      await click(ctrlRefs[field].current);
      if (cancelled) return false;

      // 자동완성 타이핑 (드롭다운 방식이면 생략)
      if (spec.typed) {
        setTyped('');
        for (let i = 0; i < spec.typed.length; i += 1) {
          if (cancelled) return false;
          setTyped(spec.typed.slice(0, i + 1));
          await sleep(TYPE_SPEED_MS);
        }
        await sleep(150);
      }
      if (cancelled) return false;

      // 후보 목록 열고 선택
      setOpen(field);
      await sleep(300);
      if (cancelled) return false;
      await moveTo(optRefs[field].current);
      if (cancelled) return false;
      setHighlight(spec.value);
      await sleep(280);
      await click(optRefs[field].current);
      if (cancelled) return false;

      setOpen(null);
      setHighlight(null);
      setTyped('');
      setVals((prev) => ({ ...prev, [field]: spec.value }));
      setActive(null);
      await sleep(250);
      return !cancelled;
    };

    const run = async (): Promise<void> => {
      // reset
      setVals({ line: null, proc: null, part: null, recipe: null });
      setActive(null);
      setOpen(null);
      setTyped('');
      setHighlight(null);
      setUnlocked(false);
      setDone(false);
      await cursor.start({ x: -30, y: -30, transition: { duration: 0 } });
      await sleep(500);
      if (cancelled) return;

      for (const field of FIELD_ORDER) {
        const ok = await fillField(field);
        if (!ok) return;
      }

      // 하위 영역 활성화
      await moveTo(downstreamRef.current);
      if (cancelled) return;
      setUnlocked(true);
      await sleep(900);
      if (cancelled) return;

      setDone(true);
      loopTimer = setTimeout(() => setRunId((id) => id + 1), LOOP_DELAY_MS);
    };

    run();
    return () => {
      cancelled = true;
      if (loopTimer) clearTimeout(loopTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, cursor]);

  const placeholder = t('request.select_placeholder');

  const renderControlText = (field: FieldKey): React.ReactNode => {
    const val = vals[field];
    if (val) return <span className="guide-demo-val filled">{val}</span>;
    if (active === field && field !== 'line' && typed) {
      return <span className="guide-demo-val filled">{typed}</span>;
    }
    return <span className="guide-demo-val">{placeholder}</span>;
  };

  return (
    <div>
      <p className="guide-demo-lead">{t('guide.demo.step1_line_process.lead')}</p>

      <div className="guide-demo-stage" ref={stageRef}>
        {FIELD_ORDER.map((field, idx) => {
          const spec = FIELDS[field];
          const isActive = active === field;
          const isFilled = !!vals[field];
          const cls = ['guide-demo-field'];
          if (isActive) cls.push('active');
          if (isFilled) cls.push('filled', 'done');
          return (
            <div key={field} className={cls.join(' ')}>
              <div className="guide-demo-field-label">
                <span className="step-dot">{idx + 1}</span>
                {t(spec.labelKey as never)}
              </div>
              <div className="guide-demo-control" ref={ctrlRefs[field]}>
                {renderControlText(field)}
                {field === 'line' ? (
                  <span className="guide-demo-caret">▾</span>
                ) : (
                  isActive && <span className="guide-demo-cursorbar" />
                )}
              </div>

              <AnimatePresence>
                {open === field && (
                  <motion.div
                    className="guide-demo-options"
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.18 }}
                  >
                    {spec.options.map((opt) => (
                      <div
                        key={opt}
                        ref={opt === spec.value ? optRefs[field] : undefined}
                        className={`guide-demo-opt${highlight === opt ? ' hi' : ''}`}
                      >
                        {opt}
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {/* 하위 영역 */}
        <div
          className={`guide-demo-downstream${unlocked ? ' unlocked' : ''}`}
          ref={downstreamRef}
        >
          <span className="guide-demo-lock-badge">
            {unlocked
              ? t('guide.demo.step1_line_process.unlocked')
              : t('guide.demo.step1_line_process.locked')}
          </span>
          <div className="guide-demo-downstream-title">
            {t('guide.demo.step1_line_process.downstream_title')}
          </div>
          <div className="guide-demo-pill-row">
            {['신규', '차용', 'Flow Chart', 'BB 조합 구역'].map((p) => (
              <span key={p} className="guide-demo-pill">{p}</span>
            ))}
          </div>
        </div>

        {/* 커서 + 클릭 리플 */}
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
      </div>

      <div className="guide-demo-callout">
        {t('guide.demo.step1_line_process.callout')}
      </div>

      <div className="guide-demo-controls">
        <button
          type="button"
          className="guide-demo-replay"
          onClick={() => setRunId((id) => id + 1)}
        >
          {t('guide.demo.replay')}
        </button>
        <span className="guide-demo-status">
          {done ? t('guide.demo.done_loop') : t('guide.demo.playing')}
        </span>
      </div>
    </div>
  );
};

export default Step1LineProcessDemo;
