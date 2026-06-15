import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DemoControls, useDemoTimeline } from './parts';

type Phase = 'cfamily' | 'region' | 'deviation' | 'xmark' | 'rev';
type RegionKey = 'top' | 'middle' | 'bottom';
interface RegionRow {
  line: string;
  proc: string;
  prod: string;
}

const REV_LAYERS = ['M1', 'M2', 'V1'];
const PICK_LAYER = 'M1';

const Step2CfamilyDemo: React.FC = () => {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('cfamily');
  const [cfamily, setCfamily] = useState<'No' | 'Yes'>('No');
  const [applyRegion, setApplyRegion] = useState<RegionKey | null>(null);
  const [top, setTop] = useState<RegionRow>({ line: '', proc: '', prod: '' });
  const [bottom, setBottom] = useState<RegionRow>({ line: '', proc: '', prod: '' });
  const [middle, setMiddle] = useState<'' | 'use' | 'unuse'>('');
  const [devTopX, setDevTopX] = useState('');
  const [devTopY, setDevTopY] = useState('');
  const [devBotX, setDevBotX] = useState('');
  const [devBotY, setDevBotY] = useState('');
  const [xmarkAdd, setXmarkAdd] = useState(false);
  const [topImg, setTopImg] = useState(false);
  const [botImg, setBotImg] = useState(false);
  const [pasteChip, setPasteChip] = useState(false);
  const [revYn, setRevYn] = useState<'' | 'YES' | 'NO'>('');
  const [revLayer, setRevLayer] = useState<string | null>(null);
  const [revGds, setRevGds] = useState('');
  const [revEntries, setRevEntries] = useState<{ layer: string; gds: string }[]>([]);

  const refs = useRef<Record<string, HTMLElement | null>>({});
  const setRef = (key: string) => (el: HTMLElement | null) => { refs.current[key] = el; };

  const { stageRef, cursorLayer, done, replay } = useDemoTimeline(
    async ({ moveTo, click, sleep, cancelled }) => {
      const typeText = async (setter: (v: string) => void, text: string): Promise<boolean> => {
        for (let i = 0; i < text.length; i += 1) {
          if (cancelled()) return false;
          setter(text.slice(0, i + 1));
          await sleep(90);
        }
        return true;
      };
      const pick = async (key: string, fn: () => void): Promise<boolean> => {
        await moveTo(refs.current[key]);
        await click(refs.current[key]);
        fn();
        await sleep(280);
        return !cancelled();
      };

      // reset
      setPhase('cfamily');
      setCfamily('No');
      setApplyRegion(null);
      setTop({ line: '', proc: '', prod: '' });
      setBottom({ line: '', proc: '', prod: '' });
      setMiddle('');
      setDevTopX('');
      setDevTopY('');
      setDevBotX('');
      setDevBotY('');
      setXmarkAdd(false);
      setTopImg(false);
      setBotImg(false);
      setRevYn('');
      setRevLayer(null);
      setRevGds('');
      setRevEntries([]);
      await sleep(550);

      // ① Only C가문 = Yes
      await moveTo(refs.current.cfamilyYes);
      await click(refs.current.cfamilyYes);
      setCfamily('Yes');
      await sleep(750);

      // ② 제품 해당 위치 선택 → 해당 영역에 현재 제품 자동 채움 + 남쪽 수동 입력
      setPhase('region');
      await moveTo(refs.current.region_top);
      await click(refs.current.region_top);
      setApplyRegion('top');
      setTop({ line: 'L1', proc: 'REC_A', prod: 'PART_X' });
      await sleep(850);
      if (cancelled()) return;
      if (!(await pick('middle_unuse', () => setMiddle('unuse')))) return;
      if (!(await pick('bottom_line', () => setBottom((p) => ({ ...p, line: 'L1' }))))) return;
      if (!(await pick('bottom_proc', () => setBottom((p) => ({ ...p, proc: 'REC_B' }))))) return;
      if (!(await pick('bottom_prod', () => setBottom((p) => ({ ...p, prod: 'PART_B' }))))) return;
      await sleep(500);

      // ③ MAP 편차 (변경 있음 자동 고정, 북/남 X·Y 입력)
      setPhase('deviation');
      await moveTo(refs.current.dev_topX);
      await click(refs.current.dev_topX);
      if (!(await typeText(setDevTopX, '0.5'))) return;
      await sleep(200);
      await moveTo(refs.current.dev_topY);
      await click(refs.current.dev_topY);
      if (!(await typeText(setDevTopY, '0.2'))) return;
      await sleep(200);
      await moveTo(refs.current.dev_botX);
      await click(refs.current.dev_botX);
      if (!(await typeText(setDevBotX, '-0.5'))) return;
      await sleep(200);
      await moveTo(refs.current.dev_botY);
      await click(refs.current.dev_botY);
      if (!(await typeText(setDevBotY, '0.2'))) return;
      await sleep(700);

      // ④ X mark (C가문: 북/남 이미지 각각)
      setPhase('xmark');
      await moveTo(refs.current.xmark_add);
      await click(refs.current.xmark_add);
      setXmarkAdd(true);
      await sleep(500);
      await moveTo(refs.current.xmark_topimg);
      await click(refs.current.xmark_topimg);
      setPasteChip(true);
      await sleep(450);
      setTopImg(true);
      setPasteChip(false);
      await sleep(300);
      await moveTo(refs.current.xmark_botimg);
      await click(refs.current.xmark_botimg);
      setPasteChip(true);
      await sleep(450);
      setBotImg(true);
      setPasteChip(false);
      await sleep(600);

      // ⑤ REV 관리
      setPhase('rev');
      await moveTo(refs.current.rev_yes);
      await click(refs.current.rev_yes);
      setRevYn('YES');
      await sleep(600);
      await moveTo(refs.current.rev_layer);
      await click(refs.current.rev_layer);
      setRevLayer(PICK_LAYER);
      await sleep(350);
      await moveTo(refs.current.rev_gds);
      await click(refs.current.rev_gds);
      if (!(await typeText(setRevGds, 'v1.2'))) return;
      await sleep(250);
      await moveTo(refs.current.rev_add);
      await click(refs.current.rev_add);
      setRevEntries([{ layer: PICK_LAYER, gds: 'v1.2' }]);
      setRevLayer(null);
      setRevGds('');
      await sleep(1000);
    }
  );

  const regionRow = (key: RegionKey, row: RegionRow) => (
    <div className="guide-demo-cregion">
      <span className="rlabel">{t(`request.prodc_${key}`)}</span>
      <div className="guide-demo-select sm" ref={setRef(`${key}_line`)}>
        {row.line ? <span className="val">{row.line}</span> : <span className="ph">{t('request.prodc_line')}</span>}
      </div>
      <div className="guide-demo-select sm" ref={setRef(`${key}_proc`)}>
        {row.proc ? <span className="val">{row.proc}</span> : <span className="ph">{t('request.prodc_process_selection')}</span>}
      </div>
      <div className="guide-demo-select sm" ref={setRef(`${key}_prod`)}>
        {row.prod ? <span className="val">{row.prod}</span> : <span className="ph">{t('request.prodc_partid')}</span>}
      </div>
    </div>
  );

  return (
    <div>
      <p className="guide-demo-lead">{t('guide.demo.step2_cfamily.lead')}</p>

      <div className="guide-demo-stage" ref={stageRef} style={{ minHeight: 470 }}>
        <div className="guide-demo-phase">
          <span className="guide-demo-phase-dot" />
          {t(`guide.demo.step2_cfamily.phase_${phase}` as never)}
        </div>

        {/* Only C가문 */}
        <div className="guide-demo-formgroup">
          <div className="guide-demo-formlabel">{t('request.prodc_status')}</div>
          <div className="guide-demo-choices">
            <span className={`guide-demo-choice auto${cfamily === 'No' ? ' on' : ''}`}>No</span>
            <button type="button" ref={setRef('cfamilyYes') as React.Ref<HTMLButtonElement>} className={`guide-demo-choice auto${cfamily === 'Yes' ? ' on' : ''}`}>Yes</button>
          </div>
        </div>

        {cfamily === 'Yes' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* 제품 해당 위치 + 북/중/남 */}
            <div className="guide-demo-formgroup">
              <div className="guide-demo-formlabel">{t('request.prodc_apply_region')}</div>
              <div className="guide-demo-choices">
                {(['top', 'middle', 'bottom'] as RegionKey[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    ref={r === 'top' ? (setRef('region_top') as React.Ref<HTMLButtonElement>) : undefined}
                    className={`guide-demo-choice auto${applyRegion === r ? ' on' : ''}`}
                  >
                    {t(`request.prodc_${r}`)}
                  </button>
                ))}
              </div>
              {regionRow('top', top)}
              <div className="guide-demo-cregion">
                <span className="rlabel">{t('request.prodc_middle')}</span>
                <span className={`guide-demo-choice auto sm${middle === 'use' ? ' on' : ''}`}>{t('request.yes')}</span>
                <button type="button" ref={setRef('middle_unuse') as React.Ref<HTMLButtonElement>} className={`guide-demo-choice auto sm${middle === 'unuse' ? ' on' : ''}`}>{t('request.no')}</button>
              </div>
              {regionRow('bottom', bottom)}
            </div>

            {/* MAP 편차 */}
            <div className="guide-demo-formgroup tbvtlv">
              <div className="guide-demo-formlabel">
                {t('request.map')}
                <span className="guide-demo-cond-badge">{t('guide.demo.step2_cfamily.dev_fixed')}</span>
              </div>
              <div className="guide-demo-cregion">
                <span className="rlabel">{t('request.prodc_top')}</span>
                <div className="guide-demo-select sm" ref={setRef('dev_topX')}>
                  {devTopX ? <span className="val">{devTopX}</span> : <span className="ph">{t('request.map_value_x')}</span>}
                </div>
                <div className="guide-demo-select sm" ref={setRef('dev_topY')}>
                  {devTopY ? <span className="val">{devTopY}</span> : <span className="ph">{t('request.map_value_y')}</span>}
                </div>
              </div>
              <div className="guide-demo-cregion">
                <span className="rlabel">{t('request.prodc_bottom')}</span>
                <div className="guide-demo-select sm" ref={setRef('dev_botX')}>
                  {devBotX ? <span className="val">{devBotX}</span> : <span className="ph">{t('request.map_value_x')}</span>}
                </div>
                <div className="guide-demo-select sm" ref={setRef('dev_botY')}>
                  {devBotY ? <span className="val">{devBotY}</span> : <span className="ph">{t('request.map_value_y')}</span>}
                </div>
              </div>
              <span className="guide-demo-rule">{t('guide.demo.step2_cfamily.dev_rule')}</span>
            </div>

            {/* X mark (북/남 이미지) */}
            <div className="guide-demo-formgroup tbvtlv">
              <div className="guide-demo-formlabel">{t('request.mshot_change_status')}</div>
              <div className="guide-demo-choices">
                <span className="guide-demo-choice auto">{t('request.mshot_none')}</span>
                <button type="button" ref={setRef('xmark_add') as React.Ref<HTMLButtonElement>} className={`guide-demo-choice auto${xmarkAdd ? ' on' : ''}`}>{t('request.mshot_add')}</button>
              </div>
              {xmarkAdd && (
                <div className="guide-demo-imgrow">
                  <div className="guide-demo-imgarea sm" ref={setRef('xmark_topimg')}>
                    <span className="cap">{t('request.prodc_top')}</span>
                    {topImg ? <motion.div className="pasted" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>🖼️</motion.div> : <span>📋 Ctrl+V</span>}
                  </div>
                  <div className="guide-demo-imgarea sm" ref={setRef('xmark_botimg')}>
                    <span className="cap">{t('request.prodc_bottom')}</span>
                    {botImg ? <motion.div className="pasted" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>🖼️</motion.div> : <span>📋 Ctrl+V</span>}
                  </div>
                </div>
              )}
            </div>

            {/* REV 관리 */}
            <div className="guide-demo-formgroup tbvtlv">
              <div className="guide-demo-formlabel">
                {t('guide.demo.step2_cfamily.rev_label')}
                <span className="guide-demo-cond-badge">{t('guide.demo.step2_cfamily.rev_hint')}</span>
              </div>
              <div className="guide-demo-choices">
                <button type="button" ref={setRef('rev_yes') as React.Ref<HTMLButtonElement>} className={`guide-demo-choice auto${revYn === 'YES' ? ' on' : ''}`}>YES</button>
                <span className={`guide-demo-choice auto${revYn === 'NO' ? ' on' : ''}`}>NO</span>
              </div>
              {revYn === 'YES' && (
                <>
                  <div className="guide-demo-tbv-row" style={{ marginTop: 8 }}>
                    <span className="lbl">{t('guide.demo.common.col_layer')}</span>
                    <div className="guide-demo-sdbtns">
                      {REV_LAYERS.map((l) => (
                        <button
                          key={l}
                          type="button"
                          ref={l === PICK_LAYER ? (setRef('rev_layer') as React.Ref<HTMLButtonElement>) : undefined}
                          className={`guide-demo-sdbtn${revLayer === l ? ' on' : ''}`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="guide-demo-tbv-row">
                    <span className="lbl">GDS</span>
                    <div className="guide-demo-select sm" ref={setRef('rev_gds')} style={{ minWidth: 120 }}>
                      {revGds ? <span className="val">{revGds}</span> : <span className="ph">{t('guide.demo.step2_cfamily.gds_ph')}</span>}
                    </div>
                    <button type="button" className="guide-demo-btn primary sm" ref={setRef('rev_add') as React.Ref<HTMLButtonElement>}>
                      + {t('guide.demo.common.add')}
                    </button>
                  </div>
                  {revEntries.length > 0 && (
                    <table className="guide-demo-table sm" style={{ marginTop: 6 }}>
                      <thead>
                        <tr><th>{t('guide.demo.common.col_layer')}</th><th>GDS</th></tr>
                      </thead>
                      <tbody>
                        <AnimatePresence>
                          {revEntries.map((e, i) => (
                            <motion.tr key={`${e.layer}-${i}`} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                              <td>{e.layer}</td>
                              <td>{e.gds}</td>
                            </motion.tr>
                          ))}
                        </AnimatePresence>
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}

        <AnimatePresence>
          {pasteChip && (
            <motion.div className="guide-demo-chip" initial={{ opacity: 0, y: 6, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
              📋 Ctrl + V
            </motion.div>
          )}
        </AnimatePresence>

        {cursorLayer}
      </div>

      <div className="guide-demo-callout">{t('guide.demo.step2_cfamily.callout')}</div>

      <DemoControls done={done} onReplay={replay} />
    </div>
  );
};

export default Step2CfamilyDemo;
