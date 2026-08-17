import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StepGuideGroup } from '../../components/StepGuideTour';
import { CellSelectionApi } from '../../hooks/useCellSelection';
import { BbTableRow, DetailFormState, JayerRow, OayerRow } from '../../types';
import { MAP_TYPE_CLONE, OTHER_PURPOSE_ADI_CD, TOUR_MERGE_PURPOSE, makeJayerRow, makeTourBbRows } from './constants';

interface UseStepGuideTourArgs {
  detail: DetailFormState;
  setDetail: React.Dispatch<React.SetStateAction<DetailFormState>>;
  jayerRows: JayerRow[];
  setJayerRows: React.Dispatch<React.SetStateAction<JayerRow[]>>;
  jayerChecked: Set<string>;
  setJayerChecked: React.Dispatch<React.SetStateAction<Set<string>>>;
  jayerCellSel: CellSelectionApi;
  oayerRows: OayerRow[];
  oayerChecked: Set<string>;
  setOayerChecked: React.Dispatch<React.SetStateAction<Set<string>>>;
  oayerInfoTab: 'table' | 'info';
  setOayerInfoTab: React.Dispatch<React.SetStateAction<'table' | 'info'>>;
  showAutoFillPanel: boolean;
  setShowAutoFillPanel: React.Dispatch<React.SetStateAction<boolean>>;
  bbRows: BbTableRow[];
  setBbRows: React.Dispatch<React.SetStateAction<BbTableRow[]>>;
}

interface BaseSnapshot {
  detail: DetailFormState;
  jayerRows: JayerRow[];
  jayerChecked: Set<string>;
  oayerChecked: Set<string>;
  oayerInfoTab: 'table' | 'info';
  showAutoFillPanel: boolean;
  bbRows: BbTableRow[];
}

/** J-ayer "표 자동채움" 그룹 시연용 — 10행을 만들고 첫 행에 값을 채운 뒤, 나머지 9행의
 * 같은 컬럼을 선택 상태로 만들어 "이렇게 드래그 선택 후 붙여넣으면 된다"를 보여준다. */
const makeJayerCopyPasteDemoRows = (): JayerRow[] =>
  Array.from({ length: 10 }, (_, i) => ({
    ...makeJayerRow(),
    sortOrder: i,
    process_id: 'PROC_X1',
    sp: `SP${String(i + 1).padStart(2, '0')}`,
    sd: `SD${String(i + 1).padStart(2, '0')}`,
    pp: `PP${String(i + 1).padStart(2, '0')}`,
    layerid: String((i + 1) * 10),
    st: 'O',
    new_or_copy: '신규',
    product_name: i === 0 ? 'PART_1234' : '',
  }));

/** BB "정보(적용 결과)" 그룹 시연용 — SP 정렬 전 상태를 보여주기 위해 makeTourBbRows() 순서를 뒤집는다. */
const makeBbSortDemoRows = (): BbTableRow[] => [...makeTourBbRows()].reverse();

export interface UseStepGuideTour {
  activeStep: number | null;
  openStep: (step: number) => void;
  close: () => void;
  restoreBase: () => void;
  groupsForStep: (step: number) => StepGuideGroup[];
  stepTitle: (step: number) => string;
}

/**
 * 요청서 작성 5개 위저드 스텝의 "하이라이트 가이드 투어" 상태·그룹 정의를 관리한다.
 * 조건부로만 나타나는 실제 요소(참조요청서 Merge·ADI CD·CLONE 원본위치·C가문 하위 등)는
 * 투어가 열릴 때의 상태를 스냅샷해 두고, 그룹 진입 시 필요한 값만 임시로 반영했다가
 * 다음 그룹으로 넘어가거나(항상 먼저 restoreBase) 투어를 닫을 때 정확히 되돌린다.
 */
export function useStepGuideTour(args: UseStepGuideTourArgs): UseStepGuideTour {
  const { t } = useTranslation();
  const {
    detail, setDetail,
    jayerRows, setJayerRows, jayerChecked, setJayerChecked, jayerCellSel,
    oayerRows, oayerChecked, setOayerChecked,
    oayerInfoTab, setOayerInfoTab,
    showAutoFillPanel, setShowAutoFillPanel,
    bbRows, setBbRows,
  } = args;

  const [activeStep, setActiveStep] = useState<number | null>(null);
  const baseRef = useRef<BaseSnapshot | null>(null);

  const openStep = useCallback((step: number) => {
    baseRef.current = {
      detail: JSON.parse(JSON.stringify(detail)) as DetailFormState,
      jayerRows: JSON.parse(JSON.stringify(jayerRows)) as JayerRow[],
      jayerChecked: new Set(jayerChecked),
      oayerChecked: new Set(oayerChecked),
      oayerInfoTab,
      showAutoFillPanel,
      bbRows: JSON.parse(JSON.stringify(bbRows)) as BbTableRow[],
    };
    setActiveStep(step);
  }, [detail, jayerRows, jayerChecked, oayerChecked, oayerInfoTab, showAutoFillPanel, bbRows]);

  const restoreBase = useCallback(() => {
    const base = baseRef.current;
    if (!base) return;
    setDetail(JSON.parse(JSON.stringify(base.detail)) as DetailFormState);
    setJayerRows(JSON.parse(JSON.stringify(base.jayerRows)) as JayerRow[]);
    jayerCellSel.clearCellSelection();
    setJayerChecked(new Set(base.jayerChecked));
    setOayerChecked(new Set(base.oayerChecked));
    setOayerInfoTab(base.oayerInfoTab);
    setShowAutoFillPanel(base.showAutoFillPanel);
    setBbRows(JSON.parse(JSON.stringify(base.bbRows)) as BbTableRow[]);
  }, [setDetail, setJayerRows, jayerCellSel, setJayerChecked, setOayerChecked, setOayerInfoTab, setShowAutoFillPanel, setBbRows]);

  const close = useCallback(() => {
    setActiveStep(null);
    baseRef.current = null;
  }, []);

  const stepTitle = useCallback((step: number): string => {
    switch (step) {
      case 1: return t('request.section_detail');
      case 2: return t('request.section_map');
      case 3: return t('request.job_li');
      case 4: return t('request.ovl_li');
      case 5: return t('request.bb_li');
      default: return '';
    }
  }, [t]);

  const groupsForStep = useCallback((step: number): StepGuideGroup[] => {
    const g = (key: string) => ({
      title: t(`guide.tour.step.groups.${key}.title` as never) as string,
      description: t(`guide.tour.step.groups.${key}.desc` as never) as string,
    });

    switch (step) {
      case 1:
        return [
          { selectors: ['[data-tour="line-fields"]'], ...g('s1g1') },
          { selectors: ['[data-tour="request-purpose"]'], ...g('s1g2') },
          {
            selectors: ['[data-tour="ref-doc-merge"]'],
            ...g('s1g3'),
            onEnter: () => setDetail((prev) => ({ ...prev, other_purpose: [TOUR_MERGE_PURPOSE] })),
          },
          {
            selectors: ['[data-tour="ref-doc-merge"]'],
            ...g('s1g3b'),
            onEnter: () => setDetail((prev) => ({
              ...prev,
              other_purpose: [TOUR_MERGE_PURPOSE],
              merge_ref_mode: 'none',
              merge_applied: true,
            })),
          },
          {
            selectors: ['[data-tour="adi-cd"]'],
            ...g('s1g4'),
            onEnter: () => setDetail((prev) => ({ ...prev, other_purpose: [OTHER_PURPOSE_ADI_CD] })),
          },
          { selectors: ['[data-tour="flow-chart"]'], ...g('s1g5') },
          { selectors: ['[data-tour="bb-entry"]'], ...g('s1g6') },
          { selectors: ['[data-tour="customer-vendor"]'], ...g('s1g7') },
        ];

      case 2:
        return [
          { selectors: ['[data-tour="map-purpose"]'], ...g('s2g1') },
          {
            selectors: ['[data-tour="map-source-location"]'],
            ...g('s2g2'),
            onEnter: () => setDetail((prev) => ({ ...prev, map_type: MAP_TYPE_CLONE })),
          },
          {
            selectors: ['[data-tour="map-rev"]'],
            ...g('s2g3'),
            onEnter: () => setDetail((prev) => ({ ...prev, rev_yn: 'YES' })),
          },
          { selectors: ['[data-tour="map-cfamily-toggle"]'], ...g('s2g4') },
          {
            selectors: ['[data-tour="map-cfamily-detail"]'],
            ...g('s2g5'),
            onEnter: () => setDetail((prev) => ({ ...prev, only_prodc: 'Yes' })),
          },
          {
            selectors: [
              '[data-tour="map-deviation"]',
              '[data-tour="map-exception"]',
              '[data-tour="map-xmark"]',
              '[data-tour="map-inter"]',
              '[data-tour="map-options"]',
            ],
            ...g('s2g6'),
          },
        ];

      case 3: {
        const firstJayerId = jayerRows.find((r) => !r.disabled)?.id;
        return [
          {
            selectors: ['[data-tour="jayer-table"]'],
            ...g('s3g1'),
            onEnter: () => {
              const rows = makeJayerCopyPasteDemoRows();
              setJayerRows(rows);
              jayerCellSel.selectCells(rows.map((r) => ({ rowId: r.id, col: 'product_name' })));
            },
          },
          {
            selectors: ['[data-tour="jayer-sync-cols"]'],
            ...g('s3g1b'),
            onEnter: () => setJayerRows(makeJayerCopyPasteDemoRows()),
          },
          {
            selectors: ['[data-tour="jayer-bulk-actions"]'],
            ...g('s3g2'),
            onEnter: () => { if (firstJayerId) setJayerChecked(new Set([firstJayerId])); },
          },
          { selectors: ['[data-tour="jayer-filter"]'], ...g('s3g3') },
        ];
      }

      case 4: {
        const firstOayerId = oayerRows.find((r) => !r.disabled)?.id;
        return [
          {
            selectors: ['[data-tour="oayer-tabs"]', '[data-tour="oayer-table"]'],
            ...g('s4g1'),
            onEnter: () => setOayerInfoTab('table'),
          },
          {
            selectors: ['[data-tour="oayer-bulk-actions"]'],
            ...g('s4g2'),
            onEnter: () => {
              setOayerInfoTab('table');
              if (firstOayerId) setOayerChecked(new Set([firstOayerId]));
            },
          },
          {
            selectors: ['[data-tour="oayer-partial-shot"]'],
            ...g('s4g3'),
            onEnter: () => setOayerInfoTab('info'),
          },
          {
            selectors: ['[data-tour="oayer-info-tbvtlv"]'],
            ...g('s4g4'),
            onEnter: () => setOayerInfoTab('info'),
          },
        ];
      }

      case 5:
        return [
          {
            selectors: ['[data-tour="bb-autofill"]', '[data-tour="bb-autofill-panel"]'],
            ...g('s5g1'),
            onEnter: () => setShowAutoFillPanel(true),
          },
          { selectors: ['[data-tour="bb-mapping-panel"]'], ...g('s5g2') },
          {
            selectors: ['[data-tour="bb-table"]'],
            ...g('s5g3'),
            onEnter: () => setBbRows(makeBbSortDemoRows()),
          },
          {
            selectors: ['[data-tour="bb-sp-sort"]'],
            ...g('s5g3b'),
            onEnter: () => setBbRows(makeBbSortDemoRows()),
          },
        ];

      default:
        return [];
    }
  }, [t, setDetail, jayerRows, setJayerRows, setJayerChecked, jayerCellSel, oayerRows, setOayerChecked, setOayerInfoTab, setShowAutoFillPanel, setBbRows]);

  return { activeStep, openStep, close, restoreBase, groupsForStep, stepTitle };
}
