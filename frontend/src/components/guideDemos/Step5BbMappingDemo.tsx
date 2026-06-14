import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DemoControls, useDemoTimeline } from './parts';

interface LeftRow {
  id: number;
  proc: string;
  layer: string;
  sd: string;
}
interface RightRow {
  id: string;
  proc: string;
  layer: string;
  desc: string;
}

const LEFT: LeftRow[] = [
  { id: 1, proc: 'PH', layer: 'L10', sd: 'ABLD' },
  { id: 2, proc: 'ET', layer: 'L20', sd: 'CTAA' },
  { id: 3, proc: 'ET', layer: 'L30', sd: 'PLEL' },
];
const RIGHT: RightRow[] = [
  { id: 'b1', proc: 'PH', layer: 'L10', desc: 'ABLD' },
  { id: 'b2', proc: 'ET', layer: 'L20', desc: 'CTAA' },
  { id: 'b3', proc: 'ET', layer: 'L30', desc: 'PLEL' },
];
/** 매핑할 쌍 (왼쪽 id → 오른쪽 id) */
const PAIRS: [number, string][] = [
  [1, 'b1'],
  [2, 'b2'],
];

type Phase = 'select' | 'map' | 'repeat' | 'apply';

const Step5BbMappingDemo: React.FC = () => {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('select');
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);
  const [staged, setStaged] = useState<Record<number, string>>({});
  const [applied, setApplied] = useState(false);
  const [mappedOut, setMappedOut] = useState<Set<number>>(new Set());

  const leftRowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});
  const rightRowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const applyBtnRef = useRef<HTMLButtonElement>(null);

  const stagedRightIds = new Set(Object.values(staged));
  const stagedCount = Object.keys(staged).length;

  const { stageRef, cursorLayer, done, replay } = useDemoTimeline(
    async ({ moveTo, click, sleep, cancelled }) => {
      // reset
      setPhase('select');
      setSelectedLeft(null);
      setStaged({});
      setApplied(false);
      setMappedOut(new Set());
      await sleep(550);

      for (let i = 0; i < PAIRS.length; i += 1) {
        const [leftId, rightId] = PAIRS[i];
        setPhase(i === 0 ? 'select' : 'repeat');
        await moveTo(leftRowRefs.current[leftId]);
        await click(leftRowRefs.current[leftId]);
        setSelectedLeft(leftId);
        await sleep(450);
        if (cancelled()) return;
        if (i === 0) setPhase('map');
        await moveTo(rightRowRefs.current[rightId]);
        await click(rightRowRefs.current[rightId]);
        setStaged((prev) => ({ ...prev, [leftId]: rightId }));
        await sleep(550);
        setSelectedLeft(null);
        await sleep(300);
      }

      // 적용
      setPhase('apply');
      await moveTo(applyBtnRef.current);
      await click(applyBtnRef.current);
      if (cancelled()) return;
      setApplied(true);
      setMappedOut(new Set(PAIRS.map(([l]) => l)));
      await sleep(1000);
    }
  );

  const stagedBadge = (leftId: number): React.ReactNode => {
    const rid = staged[leftId];
    if (!rid) return <span className="muted">{t('guide.demo.step5_bb_mapping.unmapped')}</span>;
    const r = RIGHT.find((x) => x.id === rid);
    return <span className="guide-demo-bb-badge sm">{r?.proc} / {r?.desc}</span>;
  };

  const appliedRows = Object.entries(staged).map(([leftId, rid]) => {
    const l = LEFT.find((x) => x.id === Number(leftId));
    const r = RIGHT.find((x) => x.id === rid);
    return { layer: l?.layer ?? '', bb: `${r?.proc} / ${r?.desc}` };
  });

  return (
    <div>
      <p className="guide-demo-lead">{t('guide.demo.step5_bb_mapping.lead')}</p>

      <div className="guide-demo-stage" ref={stageRef} style={{ minHeight: 430 }}>
        <div className="guide-demo-phase">
          <span className="guide-demo-phase-dot" />
          {t(`guide.demo.step5_bb_mapping.phase_${phase}` as never)}
        </div>

        <div className="guide-demo-bbsplit">
          {/* 왼쪽: 원본 행 */}
          <div className="guide-demo-bbpanel">
            <div className="bbpanel-title">① {t('guide.demo.step5_bb_mapping.left_title')}</div>
            <table className="guide-demo-table sm">
              <thead>
                <tr>
                  <th>{t('guide.demo.step5_bb_mapping.col_method')}</th>
                  <th>{t('guide.demo.common.col_layer')}</th>
                  <th>{t('guide.demo.step5_bb_mapping.col_bb')}</th>
                </tr>
              </thead>
              <tbody>
                {LEFT.filter((r) => !mappedOut.has(r.id)).map((row) => (
                  <tr
                    key={row.id}
                    ref={(el) => {
                      leftRowRefs.current[row.id] = el;
                    }}
                    className={selectedLeft === row.id ? 'bb-selected' : ''}
                  >
                    <td>{row.proc}</td>
                    <td>{row.layer}</td>
                    <td>{stagedBadge(row.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 오른쪽: BB 데이터 */}
          <div className="guide-demo-bbpanel">
            <div className="bbpanel-title">② {t('guide.demo.step5_bb_mapping.right_title')}</div>
            <div className="guide-demo-bb-search">🔍 {t('guide.demo.step5_bb_mapping.search_ph')}</div>
            <table className="guide-demo-table sm">
              <thead>
                <tr>
                  <th>{t('guide.demo.step5_bb_mapping.ref_method')}</th>
                  <th>{t('guide.demo.common.col_layer')}</th>
                  <th>{t('guide.demo.step5_bb_mapping.ref_desc')}</th>
                </tr>
              </thead>
              <tbody>
                {RIGHT.map((row) => (
                  <tr
                    key={row.id}
                    ref={(el) => {
                      rightRowRefs.current[row.id] = el;
                    }}
                    className={stagedRightIds.has(row.id) ? 'bb-used' : ''}
                  >
                    <td>{row.proc}</td>
                    <td>{row.layer}</td>
                    <td>{row.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 적용 행 */}
        <div className="guide-demo-bb-apply">
          <span className="hint">
            {stagedCount > 0
              ? t('guide.demo.step5_bb_mapping.staged_hint', { count: stagedCount })
              : t('guide.demo.step5_bb_mapping.apply_hint')}
          </span>
          <button type="button" className="guide-demo-btn primary sm" ref={applyBtnRef}>
            ✔ {t('guide.demo.step5_bb_mapping.apply_btn')} ({stagedCount})
          </button>
        </div>

        {/* 적용 결과 */}
        <AnimatePresence>
          {applied && appliedRows.length > 0 && (
            <motion.div
              className="guide-demo-bb-applied"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="title">✓ {t('guide.demo.step5_bb_mapping.applied_title')}</div>
              <table className="guide-demo-table sm">
                <thead>
                  <tr>
                    <th>{t('guide.demo.common.col_layer')}</th>
                    <th>{t('guide.demo.step5_bb_mapping.col_bb')}</th>
                  </tr>
                </thead>
                <tbody>
                  {appliedRows.map((r) => (
                    <tr key={r.layer}>
                      <td>{r.layer}</td>
                      <td>
                        <span className="guide-demo-bb-badge sm">{r.bb}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </motion.div>
          )}
        </AnimatePresence>

        {cursorLayer}
      </div>

      <div className="guide-demo-callout">{t('guide.demo.step5_bb_mapping.callout')}</div>

      <DemoControls done={done} onReplay={replay} />
    </div>
  );
};

export default Step5BbMappingDemo;
