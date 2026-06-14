import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DemoControls, useDemoTimeline } from './parts';

interface DemoRow {
  no: number;
  proc: string;
  sd: string;
}

const ROWS: DemoRow[] = [
  { no: 1, proc: 'PH', sd: 'ABLD' },
  { no: 2, proc: 'PH', sd: 'PLEL' },
  { no: 3, proc: 'ET', sd: 'PLEL' },
  { no: 4, proc: 'ET', sd: 'CTAA' },
];

const SD_KEYWORD = 'PLEL';

type Phase = 'open' | 'fill' | 'save' | 'apply' | 'toggle';

const Step3JayerFilterDemo: React.FC = () => {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('open');
  const [modalOpen, setModalOpen] = useState(false);
  const [nameTyped, setNameTyped] = useState('');
  const [sdInput, setSdInput] = useState('');
  const [sdChips, setSdChips] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [active, setActive] = useState(false);

  const addFilterBtnRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLDivElement>(null);
  const sdInputRef = useRef<HTMLDivElement>(null);
  const sdAddBtnRef = useRef<HTMLButtonElement>(null);
  const saveBtnRef = useRef<HTMLButtonElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);

  const sampleName = t('guide.demo.step3_jayer_filter.sample_name');

  const { stageRef, cursorLayer, done, replay } = useDemoTimeline(
    async ({ moveTo, click, sleep, cancelled }) => {
      // reset
      setPhase('open');
      setModalOpen(false);
      setNameTyped('');
      setSdInput('');
      setSdChips([]);
      setSaved(false);
      setActive(false);
      await sleep(400);

      // ① + 필터 → 모달 열기
      await moveTo(addFilterBtnRef.current);
      await click(addFilterBtnRef.current);
      setModalOpen(true);
      await sleep(550);

      // ② 필터명 + SD 키워드 입력
      setPhase('fill');
      await moveTo(nameInputRef.current);
      await click(nameInputRef.current);
      for (let i = 0; i < sampleName.length; i += 1) {
        if (cancelled()) return;
        setNameTyped(sampleName.slice(0, i + 1));
        await sleep(70);
      }
      await sleep(250);
      await moveTo(sdInputRef.current);
      await click(sdInputRef.current);
      for (let i = 0; i < SD_KEYWORD.length; i += 1) {
        if (cancelled()) return;
        setSdInput(SD_KEYWORD.slice(0, i + 1));
        await sleep(85);
      }
      await sleep(200);
      await moveTo(sdAddBtnRef.current);
      await click(sdAddBtnRef.current);
      setSdChips([SD_KEYWORD]);
      setSdInput('');
      await sleep(550);

      // ③ 저장 → 툴바에 필터 버튼 생성
      setPhase('save');
      await moveTo(saveBtnRef.current);
      await click(saveBtnRef.current);
      setModalOpen(false);
      setSaved(true);
      await sleep(650);

      // ④ 필터 클릭 → 해당 행 비활성화
      setPhase('apply');
      await moveTo(filterBtnRef.current);
      await click(filterBtnRef.current);
      setActive(true);
      await sleep(850);

      // ⑤ 다시 클릭 → 복원
      setPhase('toggle');
      await moveTo(filterBtnRef.current);
      await click(filterBtnRef.current);
      setActive(false);
      await sleep(700);
    }
  );

  const isRowDisabled = (row: DemoRow): boolean =>
    active && sdChips.some((kw) => row.sd.includes(kw));

  return (
    <div>
      <p className="guide-demo-lead">{t('guide.demo.step3_jayer_filter.lead')}</p>

      <div className="guide-demo-stage" ref={stageRef}>
        <div className="guide-demo-phase">
          <span className="guide-demo-phase-dot" />
          {t(`guide.demo.step3_jayer_filter.phase_${phase}` as never)}
        </div>

        {/* 미니 툴바 */}
        <div className="guide-demo-toolbar">
          {saved && (
            <motion.button
              type="button"
              ref={filterBtnRef}
              className={`guide-demo-toolbtn${active ? ' on' : ''}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              {sampleName}
            </motion.button>
          )}
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

        {/* 필터 생성 모달 */}
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

                <div className="guide-demo-modal-field">
                  <span className="lbl">{t('guide.demo.step3_jayer_filter.name_label')}</span>
                  <div className="guide-demo-kwbox single" ref={nameInputRef}>
                    {nameTyped ? (
                      <span className="val">{nameTyped}</span>
                    ) : (
                      <span className="ph">{t('guide.demo.step3_jayer_filter.name_ph')}</span>
                    )}
                  </div>
                </div>

                {(['sp', 'sd', 'pp'] as const).map((kw) => (
                  <div className="guide-demo-modal-field" key={kw}>
                    <span className="lbl">{t(`request.col_${kw}` as never)} {t('guide.demo.step3_jayer_filter.kw_suffix')}</span>
                    <div className="guide-demo-kwrow">
                      <div
                        className="guide-demo-kwbox"
                        ref={kw === 'sd' ? sdInputRef : undefined}
                      >
                        {kw === 'sd' && sdInput ? (
                          <span className="val">{sdInput}</span>
                        ) : (
                          <span className="ph">{t('guide.demo.step3_jayer_filter.kw_ph')}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="guide-demo-btn secondary sm"
                        ref={kw === 'sd' ? sdAddBtnRef : undefined}
                      >
                        {t('guide.demo.common.add')}
                      </button>
                      {kw === 'sd' && (
                        <AnimatePresence>
                          {sdChips.map((chip) => (
                            <motion.span
                              key={chip}
                              className="guide-demo-kwchip"
                              initial={{ opacity: 0, scale: 0.7 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0 }}
                            >
                              {chip} ✕
                            </motion.span>
                          ))}
                        </AnimatePresence>
                      )}
                    </div>
                  </div>
                ))}

                <div className="guide-demo-modal-footer">
                  <span className="guide-demo-btn ghost sm">{t('guide.demo.common.cancel')}</span>
                  <button type="button" className="guide-demo-btn primary sm" ref={saveBtnRef}>
                    {t('guide.demo.common.save')}
                  </button>
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
