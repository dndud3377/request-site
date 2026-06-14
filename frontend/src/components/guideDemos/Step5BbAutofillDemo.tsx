import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DemoControls, useDemoTimeline } from './parts';

interface Range {
  from: string;
  to: string;
  prod: string;
}

interface TRow {
  proc: string;
  layer: string;
}

const ROWS: TRow[] = [
  { proc: 'PH', layer: 'L10' },
  { proc: 'PH', layer: 'L20' },
  { proc: 'ET', layer: 'L30' },
  { proc: 'ET', layer: 'L40' },
];

/** 범위별 (시작/종료 Layer, 제품 ID)와 해당 범위가 채우는 행 layer 목록 */
const PLAN = [
  { from: 'L10', to: 'L20', prod: 'BB_A', layers: ['L10', 'L20'] },
  { from: 'L30', to: 'L40', prod: 'BB_B', layers: ['L30', 'L40'] },
];

type Phase = 'open' | 'range1' | 'add' | 'range2' | 'apply';
type Field = 'from' | 'to' | 'prod';

const fillVariants = {
  initial: { opacity: 0, y: -4 },
  shown: { opacity: 1, y: 0 },
};

const Step5BbAutofillDemo: React.FC = () => {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('open');
  const [panelOpen, setPanelOpen] = useState(false);
  const [ranges, setRanges] = useState<Range[]>([]);
  const [filled, setFilled] = useState<Record<string, string>>({});

  const autofillBtnRef = useRef<HTMLButtonElement>(null);
  const addRangeBtnRef = useRef<HTMLButtonElement>(null);
  const applyBtnRef = useRef<HTMLButtonElement>(null);
  const fromRefs = useRef<(HTMLDivElement | null)[]>([]);
  const toRefs = useRef<(HTMLDivElement | null)[]>([]);
  const prodRefs = useRef<(HTMLDivElement | null)[]>([]);

  const setField = (idx: number, field: Field, value: string) =>
    setRanges((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const { stageRef, cursorLayer, done, replay } = useDemoTimeline(
    async ({ moveTo, click, sleep, cancelled }) => {
      const fillRange = async (
        idx: number,
        refs: { from: HTMLDivElement | null; to: HTMLDivElement | null; prod: HTMLDivElement | null }
      ): Promise<boolean> => {
        const plan = PLAN[idx];
        await moveTo(refs.from);
        await click(refs.from);
        setField(idx, 'from', plan.from);
        await sleep(320);
        if (cancelled()) return false;
        await moveTo(refs.to);
        await click(refs.to);
        setField(idx, 'to', plan.to);
        await sleep(320);
        if (cancelled()) return false;
        await moveTo(refs.prod);
        await click(refs.prod);
        setField(idx, 'prod', plan.prod);
        await sleep(380);
        return !cancelled();
      };

      // reset
      setPhase('open');
      setPanelOpen(false);
      setRanges([]);
      setFilled({});
      await sleep(550);

      // ① 자동 채움 버튼 → 패널 열기
      await moveTo(autofillBtnRef.current);
      await click(autofillBtnRef.current);
      setPanelOpen(true);
      setRanges([{ from: '', to: '', prod: '' }]);
      await sleep(700);

      // ② 범위 1 설정
      setPhase('range1');
      if (
        !(await fillRange(0, {
          from: fromRefs.current[0],
          to: toRefs.current[0],
          prod: prodRefs.current[0],
        }))
      )
        return;
      await sleep(300);

      // ③ + 범위 추가
      setPhase('add');
      await moveTo(addRangeBtnRef.current);
      await click(addRangeBtnRef.current);
      setRanges((prev) => [...prev, { from: '', to: '', prod: '' }]);
      await sleep(500);

      // 범위 2 설정
      setPhase('range2');
      if (
        !(await fillRange(1, {
          from: fromRefs.current[1],
          to: toRefs.current[1],
          prod: prodRefs.current[1],
        }))
      )
        return;
      await sleep(350);

      // ④ 적용 → 범위 내 행 자동 채움
      setPhase('apply');
      await moveTo(applyBtnRef.current);
      await click(applyBtnRef.current);
      setPanelOpen(false);
      await sleep(400);
      for (const plan of PLAN) {
        for (const layer of plan.layers) {
          if (cancelled()) return;
          setFilled((prev) => ({ ...prev, [layer]: `${plan.prod} / ${layer.slice(1)}0` }));
          await sleep(240);
        }
      }
      await sleep(900);
    }
  );

  const selectBox = (
    idx: number,
    field: Field,
    placeholderKey: string,
    refArr: React.MutableRefObject<(HTMLDivElement | null)[]>
  ) => {
    const val = ranges[idx]?.[field];
    return (
      <div
        className="guide-demo-select"
        ref={(el) => {
          refArr.current[idx] = el;
        }}
      >
        {val ? (
          <span className="val">{val}</span>
        ) : (
          <span className="ph">{t(placeholderKey as never)}</span>
        )}
        <span className="caret">▾</span>
      </div>
    );
  };

  return (
    <div>
      <p className="guide-demo-lead">{t('guide.demo.step5_bb_autofill.lead')}</p>

      <div className="guide-demo-stage" ref={stageRef} style={{ minHeight: 420 }}>
        <div className="guide-demo-phase">
          <span className="guide-demo-phase-dot" />
          {t(`guide.demo.step5_bb_autofill.phase_${phase}` as never)}
        </div>

        <button type="button" className="guide-demo-btn primary" ref={autofillBtnRef}>
          📋 {t('guide.demo.step5_bb_autofill.autofill_btn')}
        </button>

        {/* Layer 범위 설정 패널 */}
        <AnimatePresence>
          {panelOpen && (
            <motion.div
              className="guide-demo-range-panel"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="title">🔷 {t('guide.demo.step5_bb_autofill.range_title')}</div>
              {ranges.map((_, idx) => (
                <div className="guide-demo-range-row" key={idx}>
                  <span className="rlabel">{t('guide.demo.step5_bb_autofill.range')} {idx + 1}:</span>
                  {selectBox(idx, 'from', 'guide.demo.step5_bb_autofill.from_ph', fromRefs)}
                  <span className="tilde">~</span>
                  {selectBox(idx, 'to', 'guide.demo.step5_bb_autofill.to_ph', toRefs)}
                  {selectBox(idx, 'prod', 'guide.demo.step5_bb_autofill.prod_ph', prodRefs)}
                </div>
              ))}
              <div className="guide-demo-range-actions">
                <button type="button" className="guide-demo-btn secondary sm" ref={addRangeBtnRef}>
                  + {t('guide.demo.step5_bb_autofill.add_range')}
                </button>
                <button type="button" className="guide-demo-btn primary sm" ref={applyBtnRef}>
                  ✔ {t('guide.demo.step5_bb_autofill.apply')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 대상 J-ayer 테이블 */}
        <div className="guide-demo-tablewrap" style={{ marginTop: 12 }}>
          <table className="guide-demo-table">
            <thead>
              <tr>
                <th>{t('request.process_id')}</th>
                <th>{t('guide.demo.common.col_layer')}</th>
                <th>{t('guide.demo.step5_bb_autofill.col_bb')}</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.layer}>
                  <td>{row.proc}</td>
                  <td>{row.layer}</td>
                  <td>
                    {filled[row.layer] ? (
                      <motion.span
                        className="guide-demo-bb-badge"
                        variants={fillVariants}
                        initial="initial"
                        animate="shown"
                      >
                        {filled[row.layer]}
                      </motion.span>
                    ) : (
                      <span className="ph" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {cursorLayer}
      </div>

      <div className="guide-demo-callout">{t('guide.demo.step5_bb_autofill.callout')}</div>

      <DemoControls done={done} onReplay={replay} />
    </div>
  );
};

export default Step5BbAutofillDemo;
