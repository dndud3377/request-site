import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DemoControls, useDemoTimeline } from './parts';

interface DemoRow {
  no: number;
  proc: string;
  sd: string;
  name: string;
  /** 단일 매칭 바코드 (null 이면 후보 2개라 드롭다운 선택 필요) */
  barcode: string | null;
  /** 후보가 여럿일 때의 옵션 목록 */
  options: string[] | null;
}

const ROWS: DemoRow[] = [
  { no: 1, proc: 'PH', sd: 'ABLD', name: 'PART_A', barcode: 'BC-A30', options: null },
  { no: 2, proc: 'PH', sd: 'PLEL', name: 'PART_B', barcode: 'BC-B30', options: null },
  { no: 3, proc: 'ET', sd: 'CTAA', name: 'PART_C', barcode: 'BC-C30', options: null },
  { no: 4, proc: 'ET', sd: 'CTAA', name: 'PART_D', barcode: null, options: ['BC-D30', 'BC-D31'] },
];

const SRC_STEP = '30';

type Phase = 'copy' | 'paste' | 'barcode' | 'dropdown' | 'disable' | 'restore';

const fillVariants = {
  initial: { opacity: 0, y: -4 },
  shown: { opacity: 1, y: 0 },
};

const Step3JayerTableDemo: React.FC = () => {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('copy');
  const [steps, setSteps] = useState<Record<number, string>>({ 1: SRC_STEP });
  const [copyMark, setCopyMark] = useState(false);
  const [copyChip, setCopyChip] = useState(false);
  const [selStep, setSelStep] = useState<Set<number>>(new Set());
  const [pasteChip, setPasteChip] = useState(false);
  const [idVals, setIdVals] = useState<Record<number, string>>({});
  const [candTag, setCandTag] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropHi, setDropHi] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [disabled, setDisabled] = useState<Set<number>>(new Set());

  const stepCellRefs = useRef<(HTMLTableCellElement | null)[]>([]);
  const idCellRefs = useRef<(HTMLTableCellElement | null)[]>([]);
  const checkRefs = useRef<(HTMLInputElement | null)[]>([]);
  const dropOptRef = useRef<HTMLDivElement>(null);
  const disableBtnRef = useRef<HTMLButtonElement>(null);
  const restoreBtnRef = useRef<HTMLButtonElement>(null);

  const candOptions = ROWS[3].options ?? [];
  const pickedBarcode = candOptions[0];

  const activeChecked = Array.from(checked).filter((n) => !disabled.has(n));
  const disabledChecked = Array.from(checked).filter((n) => disabled.has(n));

  const { stageRef, cursorLayer, done, replay } = useDemoTimeline(
    async ({ moveTo, click, sleep, cancelled }) => {
      // reset
      setPhase('copy');
      setSteps({ 1: SRC_STEP });
      setCopyMark(false);
      setCopyChip(false);
      setSelStep(new Set());
      setPasteChip(false);
      setIdVals({});
      setCandTag(false);
      setDropdownOpen(false);
      setDropHi(null);
      setChecked(new Set());
      setDisabled(new Set());
      await sleep(550);

      // ① 셀 복사
      await moveTo(stepCellRefs.current[0]);
      await click(stepCellRefs.current[0]);
      if (cancelled()) return;
      setCopyMark(true);
      setCopyChip(true);
      await sleep(950);
      setCopyChip(false);
      await sleep(250);

      // ② 드래그 선택 후 붙여넣기
      await moveTo(stepCellRefs.current[1]);
      setSelStep(new Set([2]));
      await sleep(360);
      await moveTo(stepCellRefs.current[2]);
      setSelStep(new Set([2, 3]));
      await sleep(360);
      await moveTo(stepCellRefs.current[3]);
      setSelStep(new Set([2, 3, 4]));
      await sleep(460);
      if (cancelled()) return;
      setPhase('paste');
      setPasteChip(true);
      await sleep(750);
      for (const r of [2, 3, 4]) {
        if (cancelled()) return;
        setSteps((prev) => ({ ...prev, [r]: SRC_STEP }));
        await sleep(230);
      }
      setPasteChip(false);
      setCopyMark(false);
      setSelStep(new Set());
      await sleep(550);

      // ③ 바코드 자동 매칭
      setPhase('barcode');
      await moveTo(idCellRefs.current[0]);
      if (cancelled()) return;
      for (const r of [1, 2, 3]) {
        if (cancelled()) return;
        const bc = ROWS[r - 1].barcode;
        if (bc) setIdVals((prev) => ({ ...prev, [r]: bc }));
        await sleep(300);
      }
      setCandTag(true);
      await sleep(800);

      // ④ 후보 2개 → 드롭다운 선택
      setPhase('dropdown');
      await moveTo(idCellRefs.current[3]);
      await click(idCellRefs.current[3]);
      if (cancelled()) return;
      setDropdownOpen(true);
      await sleep(550);
      await moveTo(dropOptRef.current);
      setDropHi(pickedBarcode);
      await sleep(500);
      await click(dropOptRef.current);
      if (cancelled()) return;
      setIdVals((prev) => ({ ...prev, 4: pickedBarcode }));
      setDropdownOpen(false);
      setDropHi(null);
      setCandTag(false);
      await sleep(650);

      // ⑤ 체크 후 선택 비활성화
      setPhase('disable');
      await sleep(250);
      await moveTo(checkRefs.current[2]);
      await click(checkRefs.current[2]);
      setChecked(new Set([3]));
      await sleep(220);
      await moveTo(checkRefs.current[3]);
      await click(checkRefs.current[3]);
      setChecked(new Set([3, 4]));
      await sleep(340);
      if (cancelled()) return;
      await moveTo(disableBtnRef.current);
      await click(disableBtnRef.current);
      setDisabled(new Set([3, 4]));
      await sleep(850);

      // ⑥ 복원
      setPhase('restore');
      await sleep(250);
      await moveTo(restoreBtnRef.current);
      await click(restoreBtnRef.current);
      setDisabled(new Set());
      setChecked(new Set());
      await sleep(750);
    }
  );

  return (
    <div>
      <p className="guide-demo-lead">{t('guide.demo.step3_jayer_table.lead')}</p>

      <div className="guide-demo-stage" ref={stageRef}>
        <div className="guide-demo-phase">
          <span className="guide-demo-phase-dot" />
          {t(`guide.demo.step3_jayer_table.phase_${phase}` as never)}
        </div>

        <div className="guide-demo-tablewrap">
          <table className="guide-demo-table">
            <thead>
              <tr>
                <th className="cb" />
                <th>{t('request.process_id')}</th>
                <th>{t('request.col_sd')}</th>
                <th>{t('request.col_product_name')}</th>
                <th>{t('request.col_step')}</th>
                <th>{t('request.col_item_id')}</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, idx) => {
                const isDisabled = disabled.has(row.no);
                const isChecked = checked.has(row.no);
                const stepVal = steps[row.no];
                const idVal = idVals[row.no];
                const isLastRow = idx === ROWS.length - 1;
                const stepCls = [
                  selStep.has(row.no) ? 'cell-selected' : '',
                  copyMark && idx === 0 ? 'cell-copy' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <tr
                    key={row.no}
                    className={[isDisabled ? 'disabled' : '', isChecked ? 'checked' : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <td className="cb">
                      <input
                        type="checkbox"
                        readOnly
                        checked={isChecked}
                        ref={(el) => {
                          checkRefs.current[idx] = el;
                        }}
                      />
                    </td>
                    <td>{row.proc}</td>
                    <td>{row.sd}</td>
                    <td>{row.name}</td>
                    <td
                      className={stepCls}
                      ref={(el) => {
                        stepCellRefs.current[idx] = el;
                      }}
                    >
                      {stepVal ? (
                        <motion.span variants={fillVariants} initial="initial" animate="shown">
                          {stepVal}
                        </motion.span>
                      ) : (
                        <span className="ph" />
                      )}
                    </td>
                    <td
                      className="id-cell"
                      ref={(el) => {
                        idCellRefs.current[idx] = el;
                      }}
                    >
                      {idVal ? (
                        <motion.span variants={fillVariants} initial="initial" animate="shown">
                          {idVal}
                        </motion.span>
                      ) : isLastRow && candTag ? (
                        <motion.span
                          className="guide-demo-tag warn"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                        >
                          {t('guide.demo.step3_jayer_table.cand_tag')}
                        </motion.span>
                      ) : (
                        <span className="ph" />
                      )}

                      {isLastRow && (
                        <AnimatePresence>
                          {dropdownOpen && (
                            <motion.div
                              className="guide-demo-options"
                              initial={{ opacity: 0, y: -6, scale: 0.98 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: -6, scale: 0.98 }}
                              transition={{ duration: 0.18 }}
                            >
                              {candOptions.map((opt) => (
                                <div
                                  key={opt}
                                  ref={opt === pickedBarcode ? dropOptRef : undefined}
                                  className={`guide-demo-opt${dropHi === opt ? ' hi' : ''}`}
                                >
                                  {opt}
                                </div>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <AnimatePresence>
            {copyChip && (
              <motion.div
                className="guide-demo-chip"
                initial={{ opacity: 0, y: 6, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                📋 Ctrl + C
              </motion.div>
            )}
            {pasteChip && (
              <motion.div
                className="guide-demo-chip"
                initial={{ opacity: 0, y: 6, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                📋 Ctrl + V
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="guide-demo-btnbar">
          <span className="guide-demo-btn ghost">+ {t('guide.demo.common.add_row')}</span>
          {activeChecked.length > 0 && (
            <button type="button" className="guide-demo-btn danger" ref={disableBtnRef}>
              {t('guide.demo.common.disable')} ({activeChecked.length})
            </button>
          )}
          {disabledChecked.length > 0 && (
            <button type="button" className="guide-demo-btn secondary" ref={restoreBtnRef}>
              {t('guide.demo.common.restore')} ({disabledChecked.length})
            </button>
          )}
        </div>

        {cursorLayer}
      </div>

      <div className="guide-demo-callout">{t('guide.demo.step3_jayer_table.callout')}</div>

      <DemoControls done={done} onReplay={replay} />
    </div>
  );
};

export default Step3JayerTableDemo;
