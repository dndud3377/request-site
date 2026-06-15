import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DemoControls, useDemoTimeline } from './parts';

type MapType = 'NEW' | 'CLONE' | 'EXISTING';
type Phase = 'new' | 'ea' | 'deviation' | 'xmark' | 'options' | 'clone' | 'existing';

const OPTION_KEYS = [
  'map_opt_photo_backside',
  'map_opt_eds_backside',
  'map_opt_inter',
  'map_opt_tsv',
  'map_opt_rf',
  'map_opt_fullchip',
];
const TOGGLED = ['map_opt_photo_backside', 'map_opt_tsv', 'map_opt_rf'];

const Step2MapTypeDemo: React.FC = () => {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('new');
  const [mapType, setMapType] = useState<MapType | null>(null);
  const [eaChange, setEaChange] = useState<'' | 'no' | 'yes'>('');
  const [eaValue, setEaValue] = useState('');
  const [devChange, setDevChange] = useState<'' | 'no' | 'yes'>('');
  const [devX, setDevX] = useState('');
  const [devY, setDevY] = useState('');
  const [xmark, setXmark] = useState<'' | 'none' | 'add' | 'edit' | 'delete'>('');
  const [xmarkPasted, setXmarkPasted] = useState(false);
  const [pasteChip, setPasteChip] = useState(false);
  const [options, setOptions] = useState<Set<string>>(new Set());
  const [sourceLine, setSourceLine] = useState('');
  const [sourceProduct, setSourceProduct] = useState('');

  const typeRefs = useRef<Record<MapType, HTMLButtonElement | null>>({ NEW: null, CLONE: null, EXISTING: null });
  const eaYesRef = useRef<HTMLButtonElement>(null);
  const eaValueRef = useRef<HTMLDivElement>(null);
  const devYesRef = useRef<HTMLButtonElement>(null);
  const devXRef = useRef<HTMLDivElement>(null);
  const devYRef = useRef<HTMLDivElement>(null);
  const xmarkAddRef = useRef<HTMLButtonElement>(null);
  const xmarkImgRef = useRef<HTMLDivElement>(null);
  const optRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const srcLineRef = useRef<HTMLDivElement>(null);
  const srcProdRef = useRef<HTMLDivElement>(null);

  const isExisting = mapType === 'EXISTING';

  const { stageRef, cursorLayer, done, replay } = useDemoTimeline(
    async ({ moveTo, click, sleep, cancelled }) => {
      const typeText = async (setter: (v: string) => void, text: string): Promise<boolean> => {
        for (let i = 0; i < text.length; i += 1) {
          if (cancelled()) return false;
          setter(text.slice(0, i + 1));
          await sleep(95);
        }
        return true;
      };

      // reset
      setPhase('new');
      setMapType(null);
      setEaChange('');
      setEaValue('');
      setDevChange('');
      setDevX('');
      setDevY('');
      setXmark('');
      setXmarkPasted(false);
      setPasteChip(false);
      setOptions(new Set());
      setSourceLine('');
      setSourceProduct('');
      await sleep(550);

      // ① NEW 선택
      await moveTo(typeRefs.current.NEW);
      await click(typeRefs.current.NEW);
      setMapType('NEW');
      await sleep(650);

      // ② 예외 구역 변경 → 변경 있음 + 값 입력
      setPhase('ea');
      await moveTo(eaYesRef.current);
      await click(eaYesRef.current);
      setEaChange('yes');
      await sleep(400);
      await moveTo(eaValueRef.current);
      await click(eaValueRef.current);
      if (!(await typeText(setEaValue, '5.0'))) return;
      await sleep(500);

      // ③ MAP 편차 변경 → 변경 있음 + X/Y 값 입력
      setPhase('deviation');
      await moveTo(devYesRef.current);
      await click(devYesRef.current);
      setDevChange('yes');
      await sleep(400);
      await moveTo(devXRef.current);
      await click(devXRef.current);
      if (!(await typeText(setDevX, '0.5'))) return;
      await sleep(250);
      await moveTo(devYRef.current);
      await click(devYRef.current);
      if (!(await typeText(setDevY, '-0.3'))) return;
      await sleep(500);

      // ④ X mark 변경 → 추가 + 이미지 붙여넣기
      setPhase('xmark');
      await moveTo(xmarkAddRef.current);
      await click(xmarkAddRef.current);
      setXmark('add');
      await sleep(500);
      await moveTo(xmarkImgRef.current);
      await click(xmarkImgRef.current);
      setPasteChip(true);
      await sleep(600);
      setXmarkPasted(true);
      setPasteChip(false);
      await sleep(550);

      // ④ MAP 옵션 토글
      setPhase('options');
      for (const key of TOGGLED) {
        if (cancelled()) return;
        await moveTo(optRefs.current[key]);
        await click(optRefs.current[key]);
        setOptions((prev) => new Set(prev).add(key));
        await sleep(300);
      }
      await sleep(600);

      // ⑤ CLONE 으로 변경 → 초기화 + 원본 위치/제품
      setPhase('clone');
      await moveTo(typeRefs.current.CLONE);
      await click(typeRefs.current.CLONE);
      setMapType('CLONE');
      setEaChange('');
      setEaValue('');
      setDevChange('');
      setDevX('');
      setDevY('');
      setXmark('');
      setXmarkPasted(false);
      setOptions(new Set());
      await sleep(650);
      await moveTo(srcLineRef.current);
      await click(srcLineRef.current);
      setSourceLine('L1');
      await sleep(400);
      await moveTo(srcProdRef.current);
      await click(srcProdRef.current);
      setSourceProduct('PART_1234');
      await sleep(700);

      // ⑥ EXISTING → 체크만
      setPhase('existing');
      await moveTo(typeRefs.current.EXISTING);
      await click(typeRefs.current.EXISTING);
      setMapType('EXISTING');
      setSourceLine('');
      setSourceProduct('');
      await sleep(1100);
    }
  );

  return (
    <div>
      <p className="guide-demo-lead">{t('guide.demo.step2_map_type.lead')}</p>

      <div className="guide-demo-stage" ref={stageRef} style={{ minHeight: 440 }}>
        <div className="guide-demo-phase">
          <span className="guide-demo-phase-dot" />
          {t(`guide.demo.step2_map_type.phase_${phase}` as never)}
        </div>

        {/* MAP 유형 */}
        <div className="guide-demo-formgroup">
          <div className="guide-demo-formlabel">{t('request.map_type')} <span className="req">*</span></div>
          <div className="guide-demo-choices">
            {(['NEW', 'CLONE', 'EXISTING'] as MapType[]).map((mt) => (
              <button
                key={mt}
                type="button"
                ref={(el) => { typeRefs.current[mt] = el; }}
                className={`guide-demo-choice wide${mapType === mt ? ' on' : ''}`}
              >
                {t(mt === 'NEW' ? 'request.map_type_new' : mt === 'CLONE' ? 'request.map_type_borrow' : 'request.map_type_registered')}
              </button>
            ))}
          </div>
        </div>

        {/* CLONE: 원본 위치/제품 */}
        <AnimatePresence>
          {mapType === 'CLONE' && (
            <motion.div
              className="guide-demo-formgroup"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="guide-demo-formlabel highlight">{t('guide.demo.step2_map_type.source_label')}</div>
              <div className="guide-demo-tbv-row">
                <span className="lbl">{t('request.source_line')}</span>
                <div className="guide-demo-select" ref={srcLineRef} style={{ flex: 1 }}>
                  {sourceLine ? <span className="val">{sourceLine}</span> : <span className="ph">{t('request.select_placeholder')}</span>}
                  <span className="caret">▾</span>
                </div>
              </div>
              <div className="guide-demo-tbv-row">
                <span className="lbl">{t('request.source_partid_selection')}</span>
                <div className="guide-demo-select" ref={srcProdRef} style={{ flex: 1 }}>
                  {sourceProduct ? <span className="val">{sourceProduct}</span> : <span className="ph">{t('request.select_placeholder')}</span>}
                  <span className="caret">▾</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 기능 영역 (EXISTING이면 비활성) */}
        <div className={`guide-demo-featurewrap${isExisting ? ' disabled' : ''}`}>
          {/* 예외 구역 변경 */}
          <div className="guide-demo-formgroup">
            <div className="guide-demo-formlabel">{t('request.ea_change')}</div>
            <div className="guide-demo-choices">
              <span className={`guide-demo-choice auto${eaChange === 'no' ? ' on' : ''}`}>{t('request.no_change')}</span>
              <button type="button" ref={eaYesRef} className={`guide-demo-choice auto${eaChange === 'yes' ? ' on' : ''}`}>{t('request.has_change')}</button>
              {eaChange === 'yes' && (
                <div className="guide-demo-select" ref={eaValueRef} style={{ minWidth: 110 }}>
                  {eaValue ? <span className="val">{eaValue}</span> : <span className="ph">{t('request.ea_value')}</span>}
                </div>
              )}
            </div>
          </div>

          {/* MAP 편차 변경 */}
          <div className="guide-demo-formgroup">
            <div className="guide-demo-formlabel">{t('request.map')}</div>
            <div className="guide-demo-choices">
              <span className={`guide-demo-choice auto${devChange === 'no' ? ' on' : ''}`}>{t('request.map_no_change')}</span>
              <button type="button" ref={devYesRef} className={`guide-demo-choice auto${devChange === 'yes' ? ' on' : ''}`}>{t('request.map_has_change')}</button>
              {devChange === 'yes' && (
                <>
                  <div className="guide-demo-select" ref={devXRef} style={{ minWidth: 84 }}>
                    {devX ? <span className="val">{devX}</span> : <span className="ph">{t('request.map_value_x')}</span>}
                  </div>
                  <div className="guide-demo-select" ref={devYRef} style={{ minWidth: 84 }}>
                    {devY ? <span className="val">{devY}</span> : <span className="ph">{t('request.map_value_y')}</span>}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* X mark 변경 */}
          <div className="guide-demo-formgroup">
            <div className="guide-demo-formlabel">{t('request.mshot_change_status')}</div>
            <div className="guide-demo-choices">
              {(['none', 'add', 'edit', 'delete'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  ref={m === 'add' ? xmarkAddRef : undefined}
                  className={`guide-demo-choice auto${xmark === m ? ' on' : ''}`}
                >
                  {t(`request.mshot_${m}` as never)}
                </button>
              ))}
            </div>
            {xmark === 'add' && (
              <div className="guide-demo-imgarea" ref={xmarkImgRef}>
                {xmarkPasted ? (
                  <motion.div className="pasted" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                    🖼️ image.png
                  </motion.div>
                ) : (
                  <span>📋 {t('request.mshot_change_image_attach_area')} (Ctrl+V)</span>
                )}
              </div>
            )}
          </div>

          {/* MAP 옵션 */}
          <div className="guide-demo-formgroup">
            <div className="guide-demo-formlabel">{t('request.map_option_title')}</div>
            <div className="guide-demo-sdbtns">
              {OPTION_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  ref={(el) => { optRefs.current[key] = el; }}
                  className={`guide-demo-sdbtn${options.has(key) ? ' on' : ''}`}
                >
                  {t(`request.${key}` as never)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isExisting && (
          <motion.div className="guide-demo-existing-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            ✓ {t('guide.demo.step2_map_type.existing_note')}
          </motion.div>
        )}

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

        {cursorLayer}
      </div>

      <div className="guide-demo-callout">{t('guide.demo.step2_map_type.callout')}</div>

      <DemoControls done={done} onReplay={replay} />
    </div>
  );
};

export default Step2MapTypeDemo;
