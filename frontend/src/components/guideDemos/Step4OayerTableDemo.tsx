import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DemoControls, useDemoTimeline } from './parts';

type Tab = 'table' | 'info';
type Phase = 'table' | 'switch' | 'partial' | 'tbvtlv_cond' | 'tbvtlv_fill' | 'tbvtlv_delete';

interface TRow {
  no: number;
  sd: string;
  layer: string;
  step: string;
}

const SRC_NAME = 'PART_1234';

const ROWS: TRow[] = [
  { no: 1, sd: 'TBV_01', layer: 'M1', step: '10' },
  { no: 2, sd: 'TLV_02', layer: 'M2', step: '20' },
  { no: 3, sd: 'CTAA', layer: 'V1', step: '30' },
];

const SD_OPTIONS = ['TBV_01', 'TLV_02'];
const PICK_SD = 'TBV_01';
const THICKNESS = '5.0';
const NOTE = 'OK';

const fillVariants = {
  initial: { opacity: 0, y: -4 },
  shown: { opacity: 1, y: 0 },
};

interface Entry {
  sd: string;
  note: string;
}

const Step4OayerTableDemo: React.FC = () => {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('table');
  const [tab, setTab] = useState<Tab>('table');
  const [names, setNames] = useState<Record<number, string>>({ 1: SRC_NAME });
  const [steps, setSteps] = useState<Record<number, string>>({});
  const [selName, setSelName] = useState<Set<number>>(new Set());
  const [copyMark, setCopyMark] = useState(false);
  const [copyChip, setCopyChip] = useState(false);
  const [pasteChip, setPasteChip] = useState(false);
  const [partialShot, setPartialShot] = useState<'O' | 'X' | null>(null);
  const [thickness, setThickness] = useState('');
  const [sdSelected, setSdSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);

  const nameCellRefs = useRef<(HTMLTableCellElement | null)[]>([]);
  const infoTabRef = useRef<HTMLButtonElement>(null);
  const partialORef = useRef<HTMLButtonElement>(null);
  const thicknessRef = useRef<HTMLDivElement>(null);
  const sdBtnRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const deleteEntryRef = useRef<HTMLButtonElement>(null);

  const { stageRef, cursorLayer, done, replay } = useDemoTimeline(
    async ({ moveTo, click, sleep, cancelled }) => {
      const typeInto = async (
        setter: (v: string) => void,
        text: string,
        speed = 95
      ): Promise<boolean> => {
        for (let i = 0; i < text.length; i += 1) {
          if (cancelled()) return false;
          setter(text.slice(0, i + 1));
          await sleep(speed);
        }
        return true;
      };

      // reset
      setPhase('table');
      setTab('table');
      setNames({ 1: SRC_NAME });
      setSteps({});
      setSelName(new Set());
      setCopyMark(false);
      setCopyChip(false);
      setPasteChip(false);
      setPartialShot(null);
      setThickness('');
      setSdSelected(null);
      setNote('');
      setEntries([]);
      await sleep(550);

      // ① OVL Layer 목록 탭 — 제품명 복사 → 드래그 붙여넣기 → STEP 자동 채움
      await moveTo(nameCellRefs.current[0]);
      await click(nameCellRefs.current[0]);
      setCopyMark(true);
      setCopyChip(true);
      await sleep(850);
      setCopyChip(false);
      await sleep(200);
      await moveTo(nameCellRefs.current[1]);
      setSelName(new Set([2]));
      await sleep(320);
      await moveTo(nameCellRefs.current[2]);
      setSelName(new Set([2, 3]));
      await sleep(420);
      if (cancelled()) return;
      setPasteChip(true);
      await sleep(650);
      for (const r of [2, 3]) {
        if (cancelled()) return;
        setNames((prev) => ({ ...prev, [r]: SRC_NAME }));
        await sleep(220);
      }
      setPasteChip(false);
      setCopyMark(false);
      setSelName(new Set());
      await sleep(400);
      for (const row of ROWS) {
        if (cancelled()) return;
        setSteps((prev) => ({ ...prev, [row.no]: row.step }));
        await sleep(230);
      }
      await sleep(700);

      // ② OVL 정보 탭으로 전환
      setPhase('switch');
      await sleep(250);
      await moveTo(infoTabRef.current);
      await click(infoTabRef.current);
      setTab('info');
      await sleep(750);

      // ③ Partial Shot 필수 선택
      setPhase('partial');
      await moveTo(partialORef.current);
      await click(partialORef.current);
      setPartialShot('O');
      await sleep(750);

      // ④ TBV/TLV 표시 조건 안내
      setPhase('tbvtlv_cond');
      await sleep(1100);

      // ⑤ 두께·SD·비고 입력 후 추가
      setPhase('tbvtlv_fill');
      await moveTo(thicknessRef.current);
      await click(thicknessRef.current);
      if (!(await typeInto(setThickness, THICKNESS))) return;
      await sleep(200);
      await moveTo(sdBtnRef.current);
      await click(sdBtnRef.current);
      setSdSelected(PICK_SD);
      await sleep(300);
      await moveTo(noteRef.current);
      await click(noteRef.current);
      if (!(await typeInto(setNote, NOTE))) return;
      await sleep(200);
      await moveTo(addBtnRef.current);
      await click(addBtnRef.current);
      if (cancelled()) return;
      setEntries([{ sd: PICK_SD, note: NOTE }]);
      setSdSelected(null);
      setNote('');
      await sleep(850);

      // ⑥ 추가 항목 삭제
      setPhase('tbvtlv_delete');
      await moveTo(deleteEntryRef.current);
      await click(deleteEntryRef.current);
      setEntries([]);
      await sleep(800);
    }
  );

  return (
    <div>
      <p className="guide-demo-lead">{t('guide.demo.step4_oayer_table.lead')}</p>

      <div className="guide-demo-stage" ref={stageRef} style={{ minHeight: 430 }}>
        <div className="guide-demo-phase">
          <span className="guide-demo-phase-dot" />
          {t(`guide.demo.step4_oayer_table.phase_${phase}` as never)}
        </div>

        {/* 탭 */}
        <div className="guide-demo-tabs">
          <button type="button" className={`guide-demo-tab${tab === 'table' ? ' on' : ''}`}>
            {t('request.ovl_tab_table')}
          </button>
          <button
            type="button"
            ref={infoTabRef}
            className={`guide-demo-tab${tab === 'info' ? ' on' : ''}`}
          >
            {t('request.ovl_tab_info')}
          </button>
        </div>

        {/* 탭 1: OVL Layer 목록 */}
        {tab === 'table' && (
          <div className="guide-demo-tablewrap">
            <div className="guide-demo-mini-note">{t('guide.demo.step4_oayer_table.table_note')}</div>
            <table className="guide-demo-table">
              <thead>
                <tr>
                  <th className="cb" />
                  <th>{t('request.col_sd')}</th>
                  <th>{t('guide.demo.common.col_layer')}</th>
                  <th>{t('request.col_product_name')}</th>
                  <th>{t('request.col_step')}</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row, idx) => (
                  <tr key={row.no}>
                    <td className="cb">
                      <input type="checkbox" readOnly />
                    </td>
                    <td>{row.sd}</td>
                    <td>{row.layer}</td>
                    <td
                      className={[
                        selName.has(row.no) ? 'cell-selected' : '',
                        copyMark && idx === 0 ? 'cell-copy' : '',
                      ].filter(Boolean).join(' ')}
                      ref={(el) => {
                        nameCellRefs.current[idx] = el;
                      }}
                    >
                      {names[row.no] ? (
                        <motion.span variants={fillVariants} initial="initial" animate="shown">
                          {names[row.no]}
                        </motion.span>
                      ) : (
                        <span className="ph" />
                      )}
                    </td>
                    <td>
                      {steps[row.no] ? (
                        <motion.span variants={fillVariants} initial="initial" animate="shown">
                          {steps[row.no]}
                        </motion.span>
                      ) : (
                        <span className="ph" />
                      )}
                    </td>
                  </tr>
                ))}
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
        )}

        {/* 탭 2: OVL 정보 */}
        {tab === 'info' && (
          <div className="guide-demo-info">
            {/* Partial Shot */}
            <div className="guide-demo-formgroup">
              <div className="guide-demo-formlabel">
                {t('request.partial_shot')} <span className="req">*</span>
              </div>
              <div className="guide-demo-choices">
                {(['O', 'X'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    ref={v === 'O' ? partialORef : undefined}
                    className={`guide-demo-choice${partialShot === v ? ' on' : ''}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* TBV/TLV */}
            <div className="guide-demo-formgroup tbvtlv">
              <div className="guide-demo-formlabel">
                {t('request.tbvtlv')}
                <span className="guide-demo-cond-badge">
                  {t('guide.demo.step4_oayer_table.tbvtlv_cond')}
                </span>
              </div>

              <div className="guide-demo-tbv-row">
                <span className="lbl">{t('request.tbvtlv_thickness')}</span>
                <div className="guide-demo-kwbox" ref={thicknessRef}>
                  {thickness ? (
                    <span className="val">{thickness}</span>
                  ) : (
                    <span className="ph">{t('guide.demo.step4_oayer_table.thickness_ph')}</span>
                  )}
                </div>
              </div>

              <div className="guide-demo-tbv-row">
                <span className="lbl">{t('request.tbvtlv_sd_select')}</span>
                <div className="guide-demo-sdbtns">
                  {SD_OPTIONS.map((sd) => (
                    <button
                      key={sd}
                      type="button"
                      ref={sd === PICK_SD ? sdBtnRef : undefined}
                      className={`guide-demo-sdbtn${sdSelected === sd ? ' on' : ''}`}
                    >
                      {sd}
                    </button>
                  ))}
                </div>
              </div>

              <div className="guide-demo-tbv-row">
                <span className="lbl">{t('request.tbvtlv_note')}</span>
                <div className="guide-demo-kwbox" ref={noteRef}>
                  {note ? (
                    <span className="val">{note}</span>
                  ) : (
                    <span className="ph">{t('guide.demo.step4_oayer_table.note_ph')}</span>
                  )}
                </div>
                <button type="button" className="guide-demo-btn primary sm" ref={addBtnRef}>
                  + {t('request.tbvtlv_add')}
                </button>
              </div>

              {entries.length > 0 && (
                <table className="guide-demo-table entries">
                  <thead>
                    <tr>
                      <th>{t('request.tbvtlv_sd_select')}</th>
                      <th>{t('request.tbvtlv_note')}</th>
                      <th className="cb" />
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence>
                      {entries.map((e, i) => (
                        <motion.tr
                          key={`${e.sd}-${i}`}
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: 16 }}
                        >
                          <td>{e.sd}</td>
                          <td>{e.note}</td>
                          <td className="cb">
                            <button
                              type="button"
                              className="guide-demo-iconbtn"
                              ref={deleteEntryRef}
                            >
                              🗑️
                            </button>
                          </td>
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {cursorLayer}
      </div>

      <div className="guide-demo-callout">{t('guide.demo.step4_oayer_table.callout')}</div>

      <DemoControls done={done} onReplay={replay} />
    </div>
  );
};

export default Step4OayerTableDemo;
