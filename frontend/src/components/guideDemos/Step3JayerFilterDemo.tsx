import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DemoControls, useDemoTimeline } from './parts';

interface DemoRow {
  no: number;
  proc: string;
  sd: string;
}

interface SavedFilter {
  id: string;
  label: string;
  sp: string[];
  sd: string[];
  pp: string[];
}

const ROWS: DemoRow[] = [
  { no: 1, proc: 'PH', sd: 'ABLD' },
  { no: 2, proc: 'PH', sd: 'PLEL' },
  { no: 3, proc: 'ET', sd: 'PLEL' },
  { no: 4, proc: 'ET', sd: 'CTAA' },
];

const FILTER_ID = 'f1';
const SD_KEYWORD = 'PLEL';
const SP_KEYWORD = 'PH';

type Phase = 'create' | 'apply' | 'edit' | 'delete';

const emptyForm = (): SavedFilter => ({ id: '', label: '', sp: [], sd: [], pp: [] });

const Step3JayerFilterDemo: React.FC = () => {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('create');
  const [modalOpen, setModalOpen] = useState(false);
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SavedFilter>(emptyForm());
  const [spInput, setSpInput] = useState('');
  const [sdInput, setSdInput] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const addFilterBtnRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLDivElement>(null);
  const spInputRef = useRef<HTMLDivElement>(null);
  const sdInputRef = useRef<HTMLDivElement>(null);
  const spAddBtnRef = useRef<HTMLButtonElement>(null);
  const sdAddBtnRef = useRef<HTMLButtonElement>(null);
  const saveBtnRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const editBtnRef = useRef<HTMLButtonElement>(null);
  const deleteBtnRef = useRef<HTMLButtonElement>(null);

  const sampleName = t('guide.demo.step3_jayer_filter.sample_name');
  const activeFilter = saved.find((f) => f.id === activeId) ?? null;
  const isRowDisabled = (row: DemoRow): boolean =>
    !!activeFilter && activeFilter.sd.some((kw) => row.sd.includes(kw));

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
      setPhase('create');
      setModalOpen(false);
      setSaved([]);
      setEditingId(null);
      setForm(emptyForm());
      setSpInput('');
      setSdInput('');
      setActiveId(null);
      await sleep(550);

      // ① 필터 생성
      await moveTo(addFilterBtnRef.current);
      await click(addFilterBtnRef.current);
      setModalOpen(true);
      await sleep(650);
      await moveTo(nameInputRef.current);
      await click(nameInputRef.current);
      if (!(await typeInto((v) => setForm((p) => ({ ...p, label: v })), sampleName, 80))) return;
      await sleep(250);
      await moveTo(sdInputRef.current);
      await click(sdInputRef.current);
      if (!(await typeInto(setSdInput, SD_KEYWORD))) return;
      await sleep(150);
      await moveTo(sdAddBtnRef.current);
      await click(sdAddBtnRef.current);
      setForm((p) => ({ ...p, sd: [SD_KEYWORD] }));
      setSdInput('');
      await sleep(500);
      await moveTo(saveBtnRef.current);
      await click(saveBtnRef.current);
      if (cancelled()) return;
      setSaved([{ id: FILTER_ID, label: sampleName, sp: [], sd: [SD_KEYWORD], pp: [] }]);
      setForm(emptyForm());
      await sleep(800);

      // ② 적용 (행 비활성화)
      setPhase('apply');
      await moveTo(closeBtnRef.current);
      await click(closeBtnRef.current);
      setModalOpen(false);
      await sleep(500);
      await moveTo(filterBtnRef.current);
      await click(filterBtnRef.current);
      setActiveId(FILTER_ID);
      await sleep(850);

      // ③ 수정
      setPhase('edit');
      await moveTo(addFilterBtnRef.current);
      await click(addFilterBtnRef.current);
      setModalOpen(true);
      await sleep(600);
      await moveTo(editBtnRef.current);
      await click(editBtnRef.current);
      setEditingId(FILTER_ID);
      setForm({ id: FILTER_ID, label: sampleName, sp: [], sd: [SD_KEYWORD], pp: [] });
      await sleep(550);
      await moveTo(spInputRef.current);
      await click(spInputRef.current);
      if (!(await typeInto(setSpInput, SP_KEYWORD))) return;
      await sleep(150);
      await moveTo(spAddBtnRef.current);
      await click(spAddBtnRef.current);
      setForm((p) => ({ ...p, sp: [SP_KEYWORD] }));
      setSpInput('');
      await sleep(500);
      await moveTo(saveBtnRef.current);
      await click(saveBtnRef.current);
      if (cancelled()) return;
      setSaved((prev) => prev.map((f) => (f.id === FILTER_ID ? { ...f, sp: [SP_KEYWORD] } : f)));
      setEditingId(null);
      setForm(emptyForm());
      await sleep(750);

      // ④ 삭제
      setPhase('delete');
      await moveTo(deleteBtnRef.current);
      await click(deleteBtnRef.current);
      setSaved([]);
      setActiveId(null);
      await sleep(700);
      await moveTo(closeBtnRef.current);
      await click(closeBtnRef.current);
      setModalOpen(false);
      await sleep(750);
    }
  );

  const chip = (emoji: string, k: string) => (
    <span key={emoji + k} className="guide-demo-savedchip">
      {emoji} {k}
    </span>
  );

  return (
    <div>
      <p className="guide-demo-lead">{t('guide.demo.step3_jayer_filter.lead')}</p>

      <div className="guide-demo-stage" ref={stageRef} style={{ minHeight: 440 }}>
        <div className="guide-demo-phase">
          <span className="guide-demo-phase-dot" />
          {t(`guide.demo.step3_jayer_filter.phase_${phase}` as never)}
        </div>

        {/* 미니 툴바 */}
        <div className="guide-demo-toolbar">
          {saved.map((f) => (
            <motion.button
              key={f.id}
              type="button"
              ref={filterBtnRef}
              className={`guide-demo-toolbtn${activeId === f.id ? ' on' : ''}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              {f.label}
            </motion.button>
          ))}
          <button type="button" ref={addFilterBtnRef} className="guide-demo-toolbtn">
            + {t('guide.demo.common.add_filter')}
          </button>
        </div>

        {/* 미니 테이블 */}
        <div className="guide-demo-tablewrap">
          <table className="guide-demo-table">
            <thead>
              <tr>
                <th>{t('request.process_id')}</th>
                <th>{t('request.col_sd')}</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.no} className={isRowDisabled(row) ? 'disabled' : ''}>
                  <td>{row.proc}</td>
                  <td>{row.sd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 필터 관리 모달 */}
        <AnimatePresence>
          {modalOpen && (
            <motion.div
              className="guide-demo-modal-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="guide-demo-modal"
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.96 }}
              >
                <div className="guide-demo-modal-title">
                  {t('guide.demo.step3_jayer_filter.modal_title')}
                </div>

                {/* 저장된 필터 목록 */}
                <div className="guide-demo-section-label">
                  {t('guide.demo.step3_jayer_filter.saved_label')}
                </div>
                {saved.length === 0 ? (
                  <div className="guide-demo-saved-empty">
                    {t('guide.demo.step3_jayer_filter.saved_empty')}
                  </div>
                ) : (
                  <AnimatePresence>
                    {saved.map((f) => (
                      <motion.div
                        key={f.id}
                        className="guide-demo-saved-item"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                      >
                        <div className="info">
                          <div className="name">{f.label}</div>
                          <div className="chips">
                            {f.sp.map((k) => chip('🔵', k))}
                            {f.sd.map((k) => chip('🟢', k))}
                            {f.pp.map((k) => chip('🟠', k))}
                          </div>
                        </div>
                        <button type="button" className="guide-demo-btn secondary sm" ref={editBtnRef}>
                          {t('guide.demo.step3_jayer_filter.edit_btn')}
                        </button>
                        <button type="button" className="guide-demo-btn danger sm" ref={deleteBtnRef}>
                          {t('guide.demo.step3_jayer_filter.delete_btn')}
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}

                <div className="guide-demo-divider" />

                {/* 새 필터 만들기 / 필터 수정 */}
                <div className={`guide-demo-section-label${editingId ? ' editing' : ''}`}>
                  {editingId
                    ? t('guide.demo.step3_jayer_filter.edit_label')
                    : t('guide.demo.step3_jayer_filter.new_label')}
                </div>
                <div className="guide-demo-kwbox single name" ref={nameInputRef}>
                  {form.label ? (
                    <span className="val">{form.label}</span>
                  ) : (
                    <span className="ph">{t('guide.demo.step3_jayer_filter.name_ph')}</span>
                  )}
                </div>

                {/* SP / SD / PP 키워드 섹션 */}
                {([
                  { key: 'sp', emoji: '🔵', label: t('guide.demo.step3_jayer_filter.sp_label'), ref: spInputRef, addRef: spAddBtnRef, buf: spInput },
                  { key: 'sd', emoji: '🟢', label: t('guide.demo.step3_jayer_filter.sd_label'), ref: sdInputRef, addRef: sdAddBtnRef, buf: sdInput },
                  { key: 'pp', emoji: '🟠', label: t('guide.demo.step3_jayer_filter.pp_label'), ref: null, addRef: null, buf: '' },
                ] as const).map((sec) => (
                  <div className="guide-demo-kwsection" key={sec.key}>
                    <div className="kw-label">{sec.emoji} {sec.label}</div>
                    <div className="guide-demo-kwrow">
                      <div className="guide-demo-kwbox" ref={sec.ref ?? undefined}>
                        {sec.buf ? (
                          <span className="val">{sec.buf}</span>
                        ) : (
                          <span className="ph">{t('guide.demo.step3_jayer_filter.kw_ph')}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="guide-demo-btn secondary sm"
                        ref={sec.addRef ?? undefined}
                      >
                        + {t('guide.demo.common.add')}
                      </button>
                    </div>
                    <div className="guide-demo-kwchips">
                      <AnimatePresence>
                        {form[sec.key].map((k) => (
                          <motion.span
                            key={k}
                            className="guide-demo-kwchip"
                            initial={{ opacity: 0, scale: 0.7 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                          >
                            {k} ✕
                          </motion.span>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                ))}

                <div className="guide-demo-modal-footer between">
                  <span className="guide-demo-btn ghost sm">
                    {t('guide.demo.step3_jayer_filter.delete_all')}
                  </span>
                  <div className="right">
                    <button type="button" className="guide-demo-btn primary sm" ref={saveBtnRef}>
                      {editingId
                        ? t('guide.demo.step3_jayer_filter.apply_edit')
                        : `+ ${t('guide.demo.common.add')}`}
                    </button>
                    <button type="button" className="guide-demo-btn secondary sm" ref={closeBtnRef}>
                      {t('guide.demo.step3_jayer_filter.close')}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {cursorLayer}
      </div>

      <div className="guide-demo-callout">{t('guide.demo.step3_jayer_filter.callout')}</div>

      <DemoControls done={done} onReplay={replay} />
    </div>
  );
};

export default Step3JayerFilterDemo;
