import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DemoControls, useDemoTimeline } from './parts';

interface DemoRow {
  no: number;
  proc: string;
  sd: string;
  name: string;
  step: string;
  id: string;
}

/** proc·sd 는 자동 채움(초기 표시), name·step 은 붙여넣기, id 는 바코드 자동 매칭으로 채워진다 */
const ROWS: DemoRow[] = [
  { no: 1, proc: 'PH', sd: 'ABLD', name: 'PART_1234', step: '10', id: 'BC-0010' },
  { no: 2, proc: 'PH', sd: 'PLEL', name: 'PART_1234', step: '20', id: 'BC-0020' },
  { no: 3, proc: 'ET', sd: 'CTAA', name: 'PART_1234', step: '30', id: 'BC-0030' },
  { no: 4, proc: 'ET', sd: 'CTAA', name: 'PART_1234', step: '40', id: 'BC-0040' },
];

type Phase = 'paste' | 'barcode' | 'disable' | 'restore';

const fillVariants = {
  initial: { opacity: 0, y: -4 },
  shown: { opacity: 1, y: 0 },
};

const Step3JayerTableDemo: React.FC = () => {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('paste');
  const [revealPaste, setRevealPaste] = useState(0);
  const [revealId, setRevealId] = useState(0);
  const [pasteChip, setPasteChip] = useState(false);
  const [matchTag, setMatchTag] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [disabled, setDisabled] = useState<Set<number>>(new Set());

  const firstNameCellRef = useRef<HTMLTableCellElement>(null);
  const idHeaderRef = useRef<HTMLTableCellElement>(null);
  const checkRefs = useRef<(HTMLInputElement | null)[]>([]);
  const disableBtnRef = useRef<HTMLButtonElement>(null);
  const restoreBtnRef = useRef<HTMLButtonElement>(null);

  const activeChecked = Array.from(checked).filter((n) => !disabled.has(n));
  const disabledChecked = Array.from(checked).filter((n) => disabled.has(n));

  const { stageRef, cursorLayer, done, replay } = useDemoTimeline(
    async ({ moveTo, click, sleep, cancelled }) => {
      // reset
      setPhase('paste');
      setRevealPaste(0);
      setRevealId(0);
      setPasteChip(false);
      setMatchTag(false);
      setChecked(new Set());
      setDisabled(new Set());
      await sleep(400);

      // ① Excel 붙여넣기
      await moveTo(firstNameCellRef.current);
      await click(firstNameCellRef.current);
      if (cancelled()) return;
      setPasteChip(true);
      await sleep(550);
      for (let i = 1; i <= ROWS.length; i += 1) {
        if (cancelled()) return;
        setRevealPaste(i);
        await sleep(160);
      }
      setPasteChip(false);
      await sleep(500);

      // ② 바코드 자동 매칭
      setPhase('barcode');
      await moveTo(idHeaderRef.current);
      if (cancelled()) return;
      for (let i = 1; i <= ROWS.length; i += 1) {
        if (cancelled()) return;
        setRevealId(i);
        if (i === 1) setMatchTag(true);
        await sleep(190);
      }
      await sleep(500);
      setMatchTag(false);

      // ③ 체크 후 선택 비활성화
      setPhase('disable');
      await sleep(300);
      await moveTo(checkRefs.current[2]);
      await click(checkRefs.current[2]);
      setChecked(new Set([3]));
      await sleep(180);
      await moveTo(checkRefs.current[3]);
      await click(checkRefs.current[3]);
      setChecked(new Set([3, 4]));
      await sleep(300);
      if (cancelled()) return;
      await moveTo(disableBtnRef.current);
      await click(disableBtnRef.current);
      setDisabled(new Set([3, 4]));
      await sleep(750);

      // ④ 복원
      setPhase('restore');
      await sleep(250);
      await moveTo(restoreBtnRef.current);
      await click(restoreBtnRef.current);
      setDisabled(new Set());
      setChecked(new Set());
      await sleep(700);
    }
  );

  const phaseText = t(`guide.demo.step3_jayer_table.phase_${phase}` as never);

  return (
    <div>
      <p className="guide-demo-lead">{t('guide.demo.step3_jayer_table.lead')}</p>

      <div className="guide-demo-stage" ref={stageRef}>
        <div className="guide-demo-phase">
          <span className="guide-demo-phase-dot" />
          {phaseText}
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
                <th ref={idHeaderRef}>{t('request.col_item_id')}</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, idx) => {
                const isDisabled = disabled.has(row.no);
                const isChecked = checked.has(row.no);
                const showName = revealPaste >= row.no;
                const showStep = revealPaste >= row.no;
                const showId = revealId >= row.no;
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
                    <td ref={idx === 0 ? firstNameCellRef : undefined}>
                      {showName ? (
                        <motion.span variants={fillVariants} initial="initial" animate="shown">
                          {row.name}
                        </motion.span>
                      ) : (
                        <span className="ph" />
                      )}
                    </td>
                    <td>
                      {showStep ? (
                        <motion.span variants={fillVariants} initial="initial" animate="shown">
                          {row.step}
                        </motion.span>
                      ) : (
                        <span className="ph" />
                      )}
                    </td>
                    <td className="id-cell">
                      {showId ? (
                        <motion.span variants={fillVariants} initial="initial" animate="shown">
                          {row.id}
                        </motion.span>
                      ) : (
                        <span className="ph" />
                      )}
                      {idx === 0 && matchTag && (
                        <motion.span
                          className="guide-demo-tag"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0 }}
                        >
                          {t('guide.demo.step3_jayer_table.match_tag')}
                        </motion.span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <AnimatePresence>
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
