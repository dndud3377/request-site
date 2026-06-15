import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DemoControls, useDemoTimeline } from './parts';

interface DemoRow {
  no: number;
  sd: string;
  layer: string;
  /** STEP 은 Layer 에 맞춰 자동으로 채워진다 */
  step: string;
  /** 단일 매칭 바코드 (null 이면 후보 2개라 드롭다운 선택) */
  id: string | null;
  options: string[] | null;
}

const SRC_NAME = 'PART_1234';

const ROWS: DemoRow[] = [
  { no: 1, sd: 'ABLD', layer: 'M1', step: '10', id: 'BC-A10', options: null },
  { no: 2, sd: 'CTAA', layer: 'M2', step: '20', id: 'BC-B20', options: null },
  { no: 3, sd: 'CTAA', layer: 'V1', step: '30', id: 'BC-C30', options: null },
  { no: 4, sd: 'PLEL', layer: 'V2', step: '40', id: null, options: ['BC-D40', 'BC-D41'] },
];

type Phase = 'copy' | 'paste' | 'step' | 'barcode' | 'dropdown' | 'disable' | 'restore';

const fillVariants = {
  initial: { opacity: 0, y: -4 },
  shown: { opacity: 1, y: 0 },
};

const Step3JayerTableDemo: React.FC = () => {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('copy');
  const [names, setNames] = useState<Record<number, string>>({ 1: SRC_NAME });
  const [copyMark, setCopyMark] = useState(false);
  const [copyChip, setCopyChip] = useState(false);
  const [selName, setSelName] = useState<Set<number>>(new Set());
  const [pasteChip, setPasteChip] = useState(false);
  const [steps, setSteps] = useState<Record<number, string>>({});
  const [ids, setIds] = useState<Record<number, string>>({});
  const [candTag, setCandTag] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropHi, setDropHi] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [disabled, setDisabled] = useState<Set<number>>(new Set());

  const nameCellRefs = useRef<(HTMLTableCellElement | null)[]>([]);
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
      setNames({ 1: SRC_NAME });
      setCopyMark(false);
      setCopyChip(false);
      setSelName(new Set());
      setPasteChip(false);
      setSteps({});
      setIds({});
      setCandTag(false);
      setDropdownOpen(false);
      setDropHi(null);
      setChecked(new Set());
      setDisabled(new Set());
      await sleep(550);

      // ① 제품명 셀 복사
      await moveTo(nameCellRefs.current[0]);
      await click(nameCellRefs.current[0]);
      if (cancelled()) return;
      setCopyMark(true);
      setCopyChip(true);
      await sleep(950);
      setCopyChip(false);
      await sleep(250);

      // ② 드래그 선택 후 붙여넣기
      await moveTo(nameCellRefs.current[1]);
      setSelName(new Set([2]));
      await sleep(340);
      await moveTo(nameCellRefs.current[2]);
      setSelName(new Set([2, 3]));
      await sleep(340);
      await moveTo(nameCellRefs.current[3]);
      setSelName(new Set([2, 3, 4]));
      await sleep(440);
      if (cancelled()) return;
      setPhase('paste');
      setPasteChip(true);
      await sleep(750);
      for (const r of [2, 3, 4]) {
        if (cancelled()) return;
        setNames((prev) => ({ ...prev, [r]: SRC_NAME }));
        await sleep(220);
      }
      setPasteChip(false);
      setCopyMark(false);
      setSelName(new Set());
      await sleep(550);

      // ③ STEP 이 Layer 에 맞춰 자동 채움
      setPhase('step');
      await sleep(250);
      for (const row of ROWS) {
        if (cancelled()) return;
        setSteps((prev) => ({ ...prev, [row.no]: row.step }));
        await sleep(240);
      }
      await sleep(450);

      // ④ ID(바코드) 자동 매칭
      setPhase('barcode');
      await moveTo(idCellRefs.current[0]);
      if (cancelled()) return;
      for (const r of [1, 2, 3]) {
        if (cancelled()) return;
        const bc = ROWS[r - 1].id;
        if (bc) setIds((prev) => ({ ...prev, [r]: bc }));
        await sleep(280);
      }
      setCandTag(true);
      await sleep(700);

      // ⑤ 후보 2개 → 드롭다운에서 항목 확인 후 선택
      setPhase('dropdown');
      await moveTo(idCellRefs.current[3]);
      await click(idCellRefs.current[3]);
      if (cancelled()) return;
      setDropdownOpen(true);
      await sleep(850);
      await moveTo(dropOptRef.current);
      setDropHi(pickedBarcode);
      await sleep(500);
      await click(dropOptRef.current);
      if (cancelled()) return;
      setIds((prev) => ({ ...prev, 4: pickedBarcode }));
      setDropdownOpen(false);
      setDropHi(null);
      setCandTag(false);
      await sleep(650);

      // ⑥ 체크 후 선택 비활성화
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
      await sleep(800);

      // ⑦ 복원
      setPhase('restore');
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
                <th>{t('request.col_sd')}</th>
                <th>{t('guide.demo.common.col_layer')}</th>
                <th>{t('request.col_product_name')}</th>
                <th>{t('request.col_step')}</th>
                <th>{t('request.col_item_id')}</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, idx) => {
                const isDisabled = disabled.has(row.no);
                const isChecked = checked.has(row.no);
                const nameVal = names[row.no];
                const stepVal = steps[row.no];
                const idVal = ids[row.no];
                const isLastRow = idx === ROWS.length - 1;
                const nameCls = [
                  selName.has(row.no) ? 'cell-selected' : '',
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
                        ref={(el) => { checkRefs.current[idx] = el; }}
                      />
                    </td>
                    <td>{row.sd}</td>
                    <td>{row.layer}</td>
                    <td
                      className={nameCls}
                      ref={(el) => { nameCellRefs.current[idx] = el; }}
                    >
                      {nameVal ? (
                        <motion.span variants={fillVariants} initial="initial" animate="shown">
                          {nameVal}
                        </motion.span>
                      ) : (
                        <span className="ph" />
                      )}
                    </td>
                    <td>
                      {stepVal ? (
                        <motion.span variants={fillVariants} initial="initial" animate="shown">
                          {stepVal}
                        </motion.span>
                      ) : (
                        <span className="ph" />
                      )}
                    </td>
                    <td className="id-cell" ref={(el) => { idCellRefs.current[idx] = el; }}>
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
              <motion.div className="guide-demo-chip" initial={{ opacity: 0, y: 6, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                📋 Ctrl + C
              </motion.div>
            )}
            {pasteChip && (
              <motion.div className="guide-demo-chip" initial={{ opacity: 0, y: 6, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
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
