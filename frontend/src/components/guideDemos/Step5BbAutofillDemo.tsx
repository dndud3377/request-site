import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DemoControls, useDemoTimeline } from './parts';

interface Range {
  from: string;
  to: string;
  prod: string;
}
interface ResultRow {
  layer: string;
  sd: string;
  bbproc: string;
  bbpart: string;
}

/** 각 범위(시작/종료 Layer, 제품 ID)와 적용 시 채워지는 bb 결과 행 */
const PLAN: { from: string; to: string; prod: string; rows: ResultRow[] }[] = [
  {
    from: 'L10',
    to: 'L20',
    prod: 'BB_A',
    rows: [
      { layer: 'L10', sd: 'ABLD', bbproc: 'PH', bbpart: 'REF_A' },
      { layer: 'L20', sd: 'CTAA', bbproc: 'PH', bbpart: 'REF_A' },
    ],
  },
  {
    from: 'L30',
    to: 'L40',
    prod: 'BB_B',
    rows: [
      { layer: 'L30', sd: 'PLEL', bbproc: 'ET', bbpart: 'REF_B' },
      { layer: 'L40', sd: 'CTAA', bbproc: 'ET', bbpart: 'REF_B' },
    ],
  },
];

type Phase = 'open' | 'range1' | 'add' | 'range2' | 'apply';
type Field = 'from' | 'to' | 'prod';

const Step5BbAutofillDemo: React.FC = () => {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('open');
  const [panelOpen, setPanelOpen] = useState(false);
  const [ranges, setRanges] = useState<Range[]>([]);
  const [resultRows, setResultRows] = useState<ResultRow[]>([]);

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
      const fillRange = async (idx: number): Promise<boolean> => {
        const plan = PLAN[idx];
        await moveTo(fromRefs.current[idx]);
        await click(fromRefs.current[idx]);
        setField(idx, 'from', plan.from);
        await sleep(320);
        if (cancelled()) return false;
        await moveTo(toRefs.current[idx]);
        await click(toRefs.current[idx]);
        setField(idx, 'to', plan.to);
        await sleep(320);
        if (cancelled()) return false;
        await moveTo(prodRefs.current[idx]);
        await click(prodRefs.current[idx]);
        setField(idx, 'prod', plan.prod);
        await sleep(380);
        return !cancelled();
      };

      // reset
      setPhase('open');
      setPanelOpen(false);
      setRanges([]);
      setResultRows([]);
      await sleep(550);

      // ① 자동 채움 버튼 → 패널 열기
      await moveTo(autofillBtnRef.current);
      await click(autofillBtnRef.current);
      setPanelOpen(true);
      setRanges([{ from: '', to: '', prod: '' }]);
      await sleep(700);

      // ② 범위 1 설정
      setPhase('range1');
      if (!(await fillRange(0))) return;
      await sleep(300);

      // ③ + 범위 추가
      setPhase('add');
      await moveTo(addRangeBtnRef.current);
      await click(addRangeBtnRef.current);
      setRanges((prev) => [...prev, { from: '', to: '', prod: '' }]);
      await sleep(500);

      // 범위 2 설정
      setPhase('range2');
      if (!(await fillRange(1))) return;
      await sleep(350);

      // ④ 적용 → bb 정보(적용 결과)에 채워짐
      setPhase('apply');
      await moveTo(applyBtnRef.current);
      await click(applyBtnRef.current);
      setPanelOpen(false);
      await sleep(450);
      for (const plan of PLAN) {
        for (const row of plan.rows) {
          if (cancelled()) return;
          setResultRows((prev) => [...prev, row]);
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
      <div className="guide-demo-select" ref={(el) => { refArr.current[idx] = el; }}>
        {val ? <span className="val">{val}</span> : <span className="ph">{t(placeholderKey as never)}</span>}
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
                  <span className="guide-demo-range-x">✕</span>
                </div>
              ))}
              <div className="guide-demo-range-actions">
                <button type="button" className="guide-demo-btn secondary sm" ref={addRangeBtnRef}>
                  + {t('guide.demo.step5_bb_autofill.add_range')}
                </button>
                <button type="button" className="guide-demo-btn primary sm" ref={applyBtnRef}>
                  ✔ {t('guide.demo.step5_bb_autofill.apply')}
                </button>
                <span className="guide-demo-btn ghost sm">{t('guide.demo.step5_bb_autofill.cancel')}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* bb 정보 (적용 결과) */}
        <div className="guide-demo-bb-applied" style={{ marginTop: 12 }}>
          <div className="title">{t('guide.demo.step5_bb_autofill.result_title')}</div>
          <table className="guide-demo-table sm">
            <thead>
              <tr>
                <th>{t('guide.demo.common.col_layer')}</th>
                <th>{t('request.col_sd')}</th>
                <th>{t('guide.demo.step5_bb_autofill.col_bbproc')}</th>
                <th>{t('guide.demo.step5_bb_autofill.col_bbpart')}</th>
              </tr>
            </thead>
            <tbody>
              {resultRows.length === 0 ? (
                <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>—</td></tr>
              ) : (
                <AnimatePresence>
                  {resultRows.map((r) => (
                    <motion.tr key={r.layer} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                      <td>{r.layer}</td>
                      <td>{r.sd}</td>
                      <td><span className="guide-demo-bb-badge sm">{r.bbproc}</span></td>
                      <td>{r.bbpart}</td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              )}
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
