import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { documentsAPI, linesAPI, formOptionsAPI, uploadImageAPI, guidesAPI, usersAPI } from '../../api/client';
import { useToast } from '../../components/Toast';
import { useIdleTimer } from '../../hooks/useIdleTimer';
import { useCellSelection } from '../../hooks/useCellSelection';
import { numberBoundaryMatch } from '../../utils/specMatch';
import Modal, { ConfirmModal } from '../../components/Modal';
import { useAuth } from '../../contexts/AuthContext';
import {
  CreateDocumentInput,
  DetailFormState,
  FlowChartRow,
  JayerRow,
  OayerRow,
  BbTableRow,
  HistorySnapshot,
  RequestDocument,
  ExternalBbDataItem,
  PhotoStepOption,
  BbAutoFillRange,
  FilterSet,
  GuideFeatureKey,
  UserWithRole,
} from '../../types';
import GuideSlidePanel from '../../components/GuideSlidePanel';
import { GUIDE_DEMO_KEYS } from '../../components/guideDemos';
import {
  OPTION_LINE,
  CRegion,
  genId,
  makeRow,
  makeJayerRow,
  makeOayerRow,
  makeBbRow,
  INITIAL_DETAIL,
  INITIAL_FORM,
  DETAIL_REQUIRED,
  JAYER_EDITABLE_COLS,
  OAYER_EDITABLE_COLS,
} from './constants';
import { formatUpdatedDate, calcDisabled, emptyDraftWords } from './helpers';
import WizardIndicator from './components/WizardIndicator';
import FilterManageModal from './components/FilterManageModal';
import Step1 from './components/Step1';
import StepMap from './components/StepMap';
import Step2 from './components/Step2';
import Step3 from './components/Step3';
import Step4 from './components/Step4';

// step 값으로 바코드 후보를 좁혀 item_id 자동값을 결정한다.
// 정확히 1개 매칭이면 그 label, 그 외(0개·2개+)면 '' (드롭다운에서 선택).
const autoMatchItemId = (
  row: { step: string },
  candidates: { label: string; spec: string }[],
): string => {
  const step = row.step?.trim();
  if (!step) return '';
  const matched = candidates.filter((c) => numberBoundaryMatch(c.spec, step));
  return matched.length === 1 ? matched[0].label : '';
};

// ===== Main Component =====
export default function RequestPage(): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const addToast = useToast();
  const { currentUser } = useAuth();

  // 반려 후 재상신 모드: location.state.editDocId 가 있을 때
  const editDocId: number | null = (location.state as any)?.editDocId ?? null;
  const isEditMode = !!editDocId;

  // 지정 PL 수정 후 상신 모드
  const peerReviewDocId: number | null = (location.state as any)?.peerReviewDocId ?? null;
  const isPeerReviewMode = !!peerReviewDocId;

  const [lineOptions, setLineOptions] = useState<string[]>(OPTION_LINE as unknown as string[]);
  const [processOptions, setProcessOptions] = useState<string[]>([]);
  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [processIdOptions, setProcessIdOptions] = useState<string[]>([]);
  const [topProductOptions, setTopProductOptions] = useState<string[]>([]);
  const [middleProductOptions, setMiddleProductOptions] = useState<string[]>([]);
  const [bottomProductOptions, setBottomProductOptions] = useState<string[]>([]);

  const [BbProductOptions, setBbProductOptions] = useState<Record<number, string[]>>({});
  const [BbProductidOptions, setBbProductidOptions] = useState<Record<number, string[]>>({});

  const [FlowProductOptions, setFlowProductOptions] = useState<Record<number, string[]>>({});
  const [FlowProcessIdOptions, setFlowProcessIdOptions] = useState<Record<number, string[]>>({});
  const [FlowLayerIdOptions, setFlowLayerIdOptions] = useState<Record<number, string[]>>({});

  const [step, setStep] = useState(1);
  const [form] = useState<CreateDocumentInput>(INITIAL_FORM);
  const [detail, setDetail] = useState<DetailFormState>(INITIAL_DETAIL);
  const [jayerRows, setJayerRows] = useState<JayerRow[]>([makeJayerRow()]);
  const [jayerBarcodeCache, setJayerBarcodeCache] = useState<Record<string, { label: string; spec: string }[]>>({});
  const [oayerRows, setOayerRows] = useState<OayerRow[]>([makeOayerRow()]);
  const [bbRows, setBbRows] = useState<BbTableRow[]>([]);
  const [bbExternalData, setBbExternalData] = useState<PhotoStepOption[][]>([]);
  const [bbExternalLoading, setBbExternalLoading] = useState(false);
  const [activeBbTab, setActiveBbTab] = useState(0);
  const [selectedJayerRowId, setSelectedJayerRowId] = useState<string | null>(null);
  const [stagedMappings, setStagedMappings] = useState<Record<string, ExternalBbDataItem>>({});
  const [mappedJayerRowIds, setMappedJayerRowIds] = useState<Set<string>>(new Set());
  const [bbAutoFillRanges, setBbAutoFillRanges] = useState<BbAutoFillRange[]>([]);
  const [showAutoFillPanel, setShowAutoFillPanel] = useState(false);
  const [bbSearchQueries, setBbSearchQueries] = useState<string[]>([]);  // 탭별 검색어
  const [jayerChecked, setJayerChecked] = useState<Set<string>>(new Set());
  const [oayerChecked, setOayerChecked] = useState<Set<string>>(new Set());
  const jayerDragInfo = useRef<{ startId: string; mode: 'check' | 'uncheck' } | null>(null);
  const oayerDragInfo = useRef<{ startId: string; mode: 'check' | 'uncheck' } | null>(null);
  const [bbChecked, setBbChecked] = useState<Set<string>>(new Set());
  const [refDocId, setRefDocId] = useState<number | null>(null);
  const [refDocLabel, setRefDocLabel] = useState<string>('');
  const [refJayerRows, setRefJayerRows] = useState<JayerRow[]>([]);
  const [refOayerRows, setRefOayerRows] = useState<OayerRow[]>([]);
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false);
  const [mergeStats, setMergeStats] = useState<{ jayerMatched: number; jayerUnmatchedRef: number; oayerMatched: number; oayerUnmatchedRef: number } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [mapTypeChangeConfirm, setMapTypeChangeConfirm] = useState<{ targetType: string } | null>(null);
  const [onlyMapConfirm, setOnlyMapConfirm] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 임시저장/자동저장/상신이 동시에 create()를 호출해 의뢰서가 중복 생성되는 race 방지 가드
  const isPersistingRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitNote, setSubmitNote] = useState('');
  const [savedId, setSavedId] = useState<number | null>(editDocId ?? peerReviewDocId);

  // 동료 PL 지정 (상신 모달)
  const [designeeLoginid, setDesigneeLoginid] = useState('');
  const [designeeName, setDesigneeName] = useState('');
  const [designeeSearchQuery, setDesigneeSearchQuery] = useState('');
  const [plUserOptions, setPlUserOptions] = useState<UserWithRole[]>([]);
  const [designeeError, setDesigneeError] = useState('');
  const designeeInputRef = useRef<HTMLInputElement>(null);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const prevParsedRef = useRef<{
    detail: DetailFormState;
    jayerRows: JayerRow[];
    oayerRows: OayerRow[];
    bbRows: BbTableRow[];
    history: HistorySnapshot[];
  } | null>(null);
  const isLoadingEditRef = useRef(false);

  const [approvedDocs, setApprovedDocs] = useState<RequestDocument[]>([]);
  const [sourcePartIdOptions, setSourcePartIdOptions] = useState<string[]>([]);

  const [jayerFilterSets, setJayerFilterSets] = useState<FilterSet[]>([]);
  const [oayerFilterSets, setOayerFilterSets] = useState<FilterSet[]>([]);
  const [jayerActiveFilterIds, setJayerActiveFilterIds] = useState<Set<string>>(new Set());
  const [oayerActiveFilterIds, setOayerActiveFilterIds] = useState<Set<string>>(new Set());
  const [jayerFilterModalOpen, setJayerFilterModalOpen] = useState(false);
  const [oayerFilterModalOpen, setOayerFilterModalOpen] = useState(false);
  const [jayerNewFilter, setJayerNewFilter] = useState<{ label: string; words: { sp: string[]; sd: string[]; pp: string[] } }>({ label: '', words: emptyDraftWords() });
  const [oayerNewFilter, setOayerNewFilter] = useState<{ label: string; words: { sp: string[]; sd: string[]; pp: string[] } }>({ label: '', words: emptyDraftWords() });
  const [jayerSortBySp, setJayerSortBySp] = useState(false);
  const [oayerSortBySp, setOayerSortBySp] = useState(false);
  const [productionDate, setProductionDate] = useState<string>('');
  const [prodcCopyRegion, setProdcCopyRegion] = useState<CRegion | null>(null);
  const [revLayersSelected, setRevLayersSelected] = useState<string[]>([]);
  const [revGds, setRevGds] = useState<string>('');
  const [oayerInfoTab, setOayerInfoTab] = useState<'table' | 'info'>('table');
  const [tbvtlvSdsSelected, setTbvtlvSdsSelected] = useState<string[]>([]);
  const [tbvtlvNote, setTbvtlvNote] = useState<string>('');
  const [tbvtlvWarnModal, setTbvtlvWarnModal] = useState(false);
  const [bbConflictState, setBbConflictState] = useState<{
    duplicateLayerIds: string[];
    rowsToAdd: BbTableRow[];
    rowsToReplace: BbTableRow[];
    existingRowIdsToRemove: string[];
  } | null>(null);
  const [bbPartialAddConfirm, setBbPartialAddConfirm] = useState(false);
  const bbPartialAddRowsRef = useRef<BbTableRow[]>([]);
  const [bbResetConfirm, setBbResetConfirm] = useState(false);
  const [specialCareConfirm, setSpecialCareConfirm] = useState(false);
  const [filterDeleteConfirm, setFilterDeleteConfirm] = useState<{
    type: 'jayer' | 'oayer';
    filterId: string;
    label: string;
  } | null>(null);
  const [filterAllDeleteConfirm, setFilterAllDeleteConfirm] = useState<'jayer' | 'oayer' | null>(null);
  const [featureGuideKeys, setFeatureGuideKeys] = useState<Set<string>>(new Set());
  const [slidePanel, setSlidePanel] = useState<{ open: boolean; featureKey: GuideFeatureKey; title: string }>({
    open: false, featureKey: 'step1_line_process', title: ''
  });

  useEffect(() => {
    linesAPI.list()
      .then((lines) => { if (lines.length > 0) setLineOptions(lines.map((l) => l.name)); })
      .catch(() => { /* 폴백 유지 */ });

    // 승인된 문서 목록 로드
    documentsAPI.getApproved()
      .then((r) => {
        setApprovedDocs(r.data);
      })
      .catch(console.error);

    // localStorage에서 비활성화 FilterSet 로드 (구버전 jayerFilterWords 마이그레이션 포함)
    const savedJayerSets = localStorage.getItem('jayerFilterSets');
    if (savedJayerSets) {
      try { setJayerFilterSets(JSON.parse(savedJayerSets)); } catch { /* 파싱 실패 시 기본값 유지 */ }
    } else {
      const oldJayer = localStorage.getItem('jayerFilterWords');
      if (oldJayer) {
        try {
          const w = JSON.parse(oldJayer);
          const migrated: FilterSet[] = [{ id: String(Date.now()), label: '기존 필터', words: { sp: Array.isArray(w.sp) ? w.sp : [], sd: Array.isArray(w.sd) ? w.sd : [], pp: Array.isArray(w.pp) ? w.pp : [] } }];
          setJayerFilterSets(migrated);
          localStorage.setItem('jayerFilterSets', JSON.stringify(migrated));
          localStorage.removeItem('jayerFilterWords');
        } catch { /* noop */ }
      }
    }
    const savedOayerSets = localStorage.getItem('oayerFilterSets');
    if (savedOayerSets) {
      try { setOayerFilterSets(JSON.parse(savedOayerSets)); } catch { /* 파싱 실패 시 기본값 유지 */ }
    } else {
      const oldOayer = localStorage.getItem('oayerFilterWords');
      if (oldOayer) {
        try {
          const w = JSON.parse(oldOayer);
          const migrated: FilterSet[] = [{ id: String(Date.now() + 1), label: '기존 필터', words: { sp: Array.isArray(w.sp) ? w.sp : [], sd: Array.isArray(w.sd) ? w.sd : [], pp: Array.isArray(w.pp) ? w.pp : [] } }];
          setOayerFilterSets(migrated);
          localStorage.setItem('oayerFilterSets', JSON.stringify(migrated));
          localStorage.removeItem('oayerFilterWords');
        } catch { /* noop */ }
      }
    }

    // 기능 가이드 키 목록 로드
    guidesAPI.list({ guide_type: 'feature' })
      .then((r) => {
        const data = r.data;
        const items = Array.isArray(data) ? data : (data as { results: { feature_key: string }[] }).results ?? [];
        const dbKeys = items.map((g: { feature_key: string | null }) => g.feature_key).filter(Boolean) as string[];
        setFeatureGuideKeys(new Set([...dbKeys, ...GUIDE_DEMO_KEYS]));
      })
      .catch(() => { setFeatureGuideKeys(new Set(GUIDE_DEMO_KEYS)); });
  }, []);

  // 라인 변경 → 조합법 fetch + 하위 초기화 (C가문 리전 포함)
  useEffect(() => {
    if (!detail.line) {
      setProcessOptions([]); setProductOptions([]); setProcessIdOptions([]);
      setTopProductOptions([]); setMiddleProductOptions([]); setBottomProductOptions([]);
      return;
    }
    formOptionsAPI.getProcesses(detail.line)
      .then(setProcessOptions)
      .catch(() => setProcessOptions([]));
    if (!isLoadingEditRef.current) {
      setProductOptions([]);
      setProcessIdOptions([]);
      setTopProductOptions([]); setMiddleProductOptions([]); setBottomProductOptions([]);
      setDetail((prev) => ({ ...prev, process_selection: '', partid_selection: '', process_id: '' }));
    }
  }, [detail.line]); // eslint-disable-line react-hooks/exhaustive-deps

  // 원본 위치 변경 → 원본 제품 목록 fetch
  useEffect(() => {
    setDetail((prev) => ({ ...prev, source_partid: '' }));
    if (!detail.source_line) {
      setSourcePartIdOptions([]);
      return;
    }
    formOptionsAPI.getMapNames(detail.source_line)
      .then(setSourcePartIdOptions)
      .catch(() => setSourcePartIdOptions([]));
  }, [detail.source_line]); // eslint-disable-line react-hooks/exhaustive-deps

  // 조합법 변경 → 제품이름 fetch + 하위 초기화
  useEffect(() => {
    if (!detail.line || !detail.process_selection) {
      if (!isLoadingEditRef.current) { setProductOptions([]); setProcessIdOptions([]); }
      return;
    }
    formOptionsAPI.getProducts(detail.line, detail.process_selection)
      .then(setProductOptions)
      .catch(() => setProductOptions([]));
    if (!isLoadingEditRef.current) {
      setProcessIdOptions([]);
      setDetail((prev) => ({ ...prev, partid_selection: '', process_id: '' }));
    }
  }, [detail.process_selection]); // eslint-disable-line react-hooks/exhaustive-deps

  // 제품이름 변경 → 조리법 fetch
  useEffect(() => {
    if (!detail.line || !detail.partid_selection) {
      if (!isLoadingEditRef.current) { setProcessIdOptions([]); }
      return;
    }
    formOptionsAPI.getProcessId(detail.line, detail.partid_selection)
      .then(setProcessIdOptions)
      .catch(() => setProcessIdOptions([]));
    if (!isLoadingEditRef.current) {
      setDetail((prev) => ({ ...prev, process_id: '' }));
    }
  }, [detail.partid_selection]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!detail.line || !detail.process_id) return;
    if (isLoadingEditRef.current) return; // 편집 모드 로드 중엔 jayerRows/oayerRows 덮어쓰기 방지
    setRefDocId(null);
    setRefDocLabel('');
    setRefJayerRows([]);
    setRefOayerRows([]);
    fetchJobFileLayerAndPopulateJayer(detail.line, detail.process_id);
    fetchOvlLayerAndPopulateOayer(detail.line, detail.process_id);
  }, [detail.process_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (detail.other_purpose !== 'Layer 추가/삭제') {
      setRefDocId(null);
      setRefDocLabel('');
      setRefJayerRows([]);
      setRefOayerRows([]);
    }
  }, [detail.other_purpose]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    detail.bb_entries.forEach((entry, idx) => {
      if (!entry.location) {
        setBbProductOptions((prev) => ({ ...prev, [idx]: [] }));
        setBbProductidOptions((prev) => ({ ...prev, [idx]: [] }));
        return;
      }
      formOptionsAPI.getProducts(entry.location)
        .then((opts) => setBbProductOptions((prev) => ({ ...prev, [idx]: opts })))
        .catch(() => setBbProductOptions((prev) => ({ ...prev, [idx]: [] })));
      setBbProductidOptions((prev) => ({ ...prev, [idx]: [] }));
    });
  }, [detail.bb_entries.map(e => e.location).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.flow_chart.forEach((entry, idx) => {
      if (!entry.location) {
        setFlowProductOptions((prev) => ({ ...prev, [idx]: [] }));
        return;
      }
      formOptionsAPI.getProducts(entry.location)
        .then((opts) => setFlowProductOptions((prev) => ({ ...prev, [idx]: opts })))
        .catch(() => setFlowProductOptions((prev) => ({ ...prev, [idx]: [] })));
    });
  }, [detail.flow_chart.map(e => e.location).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.flow_chart.forEach((entry, idx) => {
      if (!entry.location || !entry.product_name) {
        setFlowProcessIdOptions((prev) => ({ ...prev, [idx]: [] }));
        return;
      }
      formOptionsAPI.getProcessId(entry.location, entry.product_name)
        .then((opts) => setFlowProcessIdOptions((prev) => ({ ...prev, [idx]: opts })))
        .catch(() => setFlowProcessIdOptions((prev) => ({ ...prev, [idx]: [] })));
    });
  }, [detail.flow_chart.map(e => `${e.location}|${e.product_name}`).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.flow_chart.forEach((entry, idx) => {
      if (!entry.location || !entry.process_id) {
        setFlowLayerIdOptions((prev) => ({ ...prev, [idx]: [] }));
        return;
      }
      formOptionsAPI.getLayerIds(entry.location, entry.process_id)
        .then((opts) => {
          const sorted = [...opts].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
          setFlowLayerIdOptions((prev) => ({ ...prev, [idx]: sorted }));
        })
        .catch(() => setFlowLayerIdOptions((prev) => ({ ...prev, [idx]: [] })));
    });
  }, [detail.flow_chart.map(e => `${e.location}|${e.process_id}`).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.bb_entries.forEach((entry, idx) => {
      if (!entry.location || !entry.product) {
        setBbProductidOptions((prev) => ({ ...prev, [idx]: [] }));
        return;
      }
      formOptionsAPI.getProcessId(entry.location, entry.product)
        .then((opts) => setBbProductidOptions((prev) => ({ ...prev, [idx]: opts })))
        .catch(() => setBbProductidOptions((prev) => ({ ...prev, [idx]: [] })));
    });
  }, [detail.bb_entries.map(e => e.product).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // bb_entries 변경 시 외부 데이터 로드
  useEffect(() => {
    if (detail.bb_entries.length === 0) return;
    setBbExternalLoading(true);
    Promise.all(detail.bb_entries.map((entry) => formOptionsAPI.getBbExternalData(entry)))
      .then((results) => {
        setBbExternalData(results);
        setActiveBbTab(0);
      })
      .catch(() => setBbExternalData([]))
      .finally(() => setBbExternalLoading(false));
  }, [detail.bb_entries]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleDragEnd = () => {
      jayerDragInfo.current = null;
      oayerDragInfo.current = null;
    };
    document.addEventListener('mouseup', handleDragEnd);
    return () => document.removeEventListener('mouseup', handleDragEnd);
  }, []);

  // 편집 모드 (반려 재상신 or 지정 PL 수정 후 상신): 기존 문서 데이터 로드
  useEffect(() => {
    const targetDocId = editDocId ?? peerReviewDocId;
    if (!targetDocId) return;
    isLoadingEditRef.current = true;
    documentsAPI.get(targetDocId).then((res) => {
      const doc = res.data;
      try {
        const parsed = JSON.parse(doc.additional_notes ?? '{}');
        prevParsedRef.current = {
          detail: parsed.detail ?? {},
          jayerRows: parsed.jayerRows ?? [],
          oayerRows: parsed.oayerRows ?? [],
          bbRows: parsed.bbRows ?? [],
          history: parsed.history ?? [],
        };
        if (doc.production_date) setProductionDate(doc.production_date);
        if (parsed.detail) setDetail(parsed.detail);
        if (parsed.jayerRows) {
          const fSets: FilterSet[] = (() => { try { return JSON.parse(localStorage.getItem('jayerFilterSets') ?? '[]'); } catch { return []; } })();
          const savedActiveIds: Set<string> = new Set(Array.isArray(parsed.jayerActiveFilterIds) ? parsed.jayerActiveFilterIds : []);
          setJayerActiveFilterIds(savedActiveIds);
          setJayerRows(parsed.jayerRows.map((r: JayerRow) => {
            const md = r.manuallyDisabled ?? r.disabled;
            return { ...r, manuallyDisabled: md, disabled: calcDisabled({ ...r, manuallyDisabled: md }, fSets, savedActiveIds) };
          }));
        }
        if (parsed.oayerRows) {
          const fSets: FilterSet[] = (() => { try { return JSON.parse(localStorage.getItem('oayerFilterSets') ?? '[]'); } catch { return []; } })();
          const savedActiveIds: Set<string> = new Set(Array.isArray(parsed.oayerActiveFilterIds) ? parsed.oayerActiveFilterIds : []);
          setOayerActiveFilterIds(savedActiveIds);
          setOayerRows(parsed.oayerRows.map((r: OayerRow) => {
            const md = r.manuallyDisabled ?? r.disabled;
            return { ...r, manuallyDisabled: md, disabled: calcDisabled({ ...r, manuallyDisabled: md }, fSets, savedActiveIds) };
          }));
        }
        if (parsed.bbRows) {
          setBbRows(parsed.bbRows);
          const existingJayerIds = parsed.bbRows
            .map((row: BbTableRow) => row.sourceJayerRowId)
            .filter(Boolean);
          setMappedJayerRowIds(new Set(existingJayerIds));
        }
      } catch { /* noop */ }
    }).catch(() => { isLoadingEditRef.current = false; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDocId, peerReviewDocId]);

  // Derived booleans for Step 1 conditional rendering
  const isMapRegistered = detail.map_type === 'EXISTING' || detail.map_type === 'CLONE';
  const isOnlyMap = detail.request_purpose === 'Only MAP';
  const hasMapChange = detail.map_change === '변경 있음';
  const hasEaChange = detail.ea_change === '변경 있음';
  const isProdc = detail.only_prodc === 'Yes';
  const mshotDeleteMode = detail.mshot_change === '삭제';
  const mshotEditAddMode = detail.mshot_change === '추가' || detail.mshot_change === '수정';
  const usedRevLayers = new Set((detail.rev_entries ?? []).flatMap((e) => e.layers));
  const availableRevLayers = Array.from(
    new Set(jayerRows.filter((r) => !r.disabled && r.layerid).map((r) => r.layerid))
  ).filter((l) => !usedRevLayers.has(l));

  // ===== Step 1 Handlers =====
  const handleDetailChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    isLoadingEditRef.current = false; // 사용자 상호작용 시 로드 가드 해제
    const { name, value } = e.target;
    setDetail((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  // 이미지 붙여넣기 핸들러 - 백엔드로 업로드
  const handleImagePaste = async (e: React.ClipboardEvent<HTMLDivElement>, fieldName: 'mshot_image_copy' | 'mshot_image_copy_top' | 'mshot_image_copy_bottom') => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          try {
            const result = await uploadImageAPI.upload(file);
            setDetail((prev) => ({
              ...prev,
              [fieldName]: result.path
            }));
            addToast(`이미지 업로드 완료: ${file.name}`, 'info');
          } catch (err) {
            console.error('이미지 업로드 실패:', err);
            addToast('이미지 업로드 실패', 'error');
          }
          e.preventDefault();
          break;
        }
      }
    }
  };

  const handleDetailSet = (name: string, value: string) => {
    isLoadingEditRef.current = false; // 사용자 상호작용 시 로드 가드 해제
    setDetail((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const handleRequestPurposeSelect = (val: string) => {
    if (val === detail.request_purpose) return;
    // 이미 선택된 목적이 있을 때 Only MAP으로 바꾸면 초기화 모달을 띄운다.
    if (val === 'Only MAP' && detail.request_purpose) {
      setOnlyMapConfirm(true);
      return;
    }
    // 첫 선택이 Only MAP이면 초기화할 것이 없으므로 모달 없이 바로 적용.
    if (val === 'Only MAP') {
      applyOnlyMap();
      return;
    }
    handleDetailSet('request_purpose', val);
  };

  // Only MAP 적용 → 라인/조합법/제품/조리법/고객/요구사항/생산일을 제외한 Step1 항목 초기화
  const applyOnlyMap = () => {
    setDetail((prev) => ({
      ...prev,
      request_purpose: 'Only MAP',
      other_purpose: INITIAL_DETAIL.other_purpose,
      flow_chart: [makeRow()],
      change_purpose_note: INITIAL_DETAIL.change_purpose_note,
      bb_entries: INITIAL_DETAIL.bb_entries.map((e) => ({ ...e })),
      // Only MAP은 StepMap 정보까지만 필요 → O-layer 정보 탭(partial_shot/TBV·TLV) 초기화
      partial_shot: INITIAL_DETAIL.partial_shot,
      tbvtlv_thickness: INITIAL_DETAIL.tbvtlv_thickness,
      tbvtlv_entries: [],
    }));
    setRefDocId(null);
    setRefDocLabel('');
    setRefJayerRows([]);
    setRefOayerRows([]);
    // Only MAP은 StepMap 정보까지만 필요 → J-layer/O-layer/Backbone 표 데이터 비우기
    setJayerRows([makeJayerRow()]);
    setOayerRows([makeOayerRow()]);
    setBbRows([]);
    setBbExternalData([]);
    setMappedJayerRowIds(new Set());
    setStagedMappings({});
    setSelectedJayerRowId(null);
    setJayerChecked(new Set());
    setOayerChecked(new Set());
    setBbChecked(new Set());
    setErrors((prev) => ({ ...prev, request_purpose: '', bb_entries: '' }));
  };

  const handleOnlyMapConfirm = () => {
    applyOnlyMap();
    setOnlyMapConfirm(false);
  };

  const handleMapTypeSelect = (val: string) => {
    if (val === detail.map_type) return;
    // 이미 선택된 map_type이 있을 때만 초기화 모달을 띄운다. 첫 선택이면 초기화할 것이 없으므로 바로 적용.
    if ((val === 'CLONE' || val === 'EXISTING') && detail.map_type) {
      setMapTypeChangeConfirm({ targetType: val });
      return;
    }
    setDetail((prev) => ({ ...prev, map_type: val }));
    if (errors['map_type']) setErrors((prev) => ({ ...prev, map_type: '' }));
  };

  const handleMapTypeChangeConfirm = () => {
    if (!mapTypeChangeConfirm) return;
    const newType = mapTypeChangeConfirm.targetType;
    // StepMap(원본·C가문·지도편차·예외구역·X표시·Map Option·REV) 필드만 초기화한다.
    // Step1/3/4/5 데이터(라인·뼈찜·partial_shot·tbvtlv 등)는 보존한다.
    setDetail((prev) => ({
      ...prev,
      map_type: newType,
      source_line: INITIAL_DETAIL.source_line,
      source_partid: INITIAL_DETAIL.source_partid,
      map_change: INITIAL_DETAIL.map_change,
      map_value_x: INITIAL_DETAIL.map_value_x,
      map_value_y: INITIAL_DETAIL.map_value_y,
      map_reason: INITIAL_DETAIL.map_reason,
      map_change_top: INITIAL_DETAIL.map_change_top,
      map_value_x_top: INITIAL_DETAIL.map_value_x_top,
      map_value_y_top: INITIAL_DETAIL.map_value_y_top,
      map_change_bottom: INITIAL_DETAIL.map_change_bottom,
      map_value_x_bottom: INITIAL_DETAIL.map_value_x_bottom,
      map_value_y_bottom: INITIAL_DETAIL.map_value_y_bottom,
      ea_change: INITIAL_DETAIL.ea_change,
      ea_value: INITIAL_DETAIL.ea_value,
      only_prodc: INITIAL_DETAIL.only_prodc,
      prodc_top_line: INITIAL_DETAIL.prodc_top_line,
      prodc_top_process: INITIAL_DETAIL.prodc_top_process,
      prodc_top_product: INITIAL_DETAIL.prodc_top_product,
      prodc_middle_use: INITIAL_DETAIL.prodc_middle_use,
      prodc_middle_line: INITIAL_DETAIL.prodc_middle_line,
      prodc_middle_process: INITIAL_DETAIL.prodc_middle_process,
      prodc_middle_product: INITIAL_DETAIL.prodc_middle_product,
      prodc_bottom_line: INITIAL_DETAIL.prodc_bottom_line,
      prodc_bottom_process: INITIAL_DETAIL.prodc_bottom_process,
      prodc_bottom_product: INITIAL_DETAIL.prodc_bottom_product,
      mshot_change: INITIAL_DETAIL.mshot_change,
      mshot_image_copy: INITIAL_DETAIL.mshot_image_copy,
      mshot_image_copy_top: INITIAL_DETAIL.mshot_image_copy_top,
      mshot_image_copy_bottom: INITIAL_DETAIL.mshot_image_copy_bottom,
      photo_backside: INITIAL_DETAIL.photo_backside,
      eds_backside: INITIAL_DETAIL.eds_backside,
      inter: INITIAL_DETAIL.inter,
      tsv: INITIAL_DETAIL.tsv,
      rf: INITIAL_DETAIL.rf,
      fullchip: INITIAL_DETAIL.fullchip,
      split: INITIAL_DETAIL.split,
      st: INITIAL_DETAIL.st,
      ecc: INITIAL_DETAIL.ecc,
      labelsideshot: INITIAL_DETAIL.labelsideshot,
      hpkglabelheight: INITIAL_DETAIL.hpkglabelheight,
      rev_yn: INITIAL_DETAIL.rev_yn,
      rev_entries: INITIAL_DETAIL.rev_entries,
    }));
    setProdcCopyRegion(null);
    setRevLayersSelected([]);
    setRevGds('');
    setErrors({});
    setMapTypeChangeConfirm(null);
  };

  // C가문 리전별 조합법 변경 → 해당 리전 제품이름 fetch
  const handleProdcProcessChange = (region: CRegion, value: string) => {
    if (!detail.line || !value) {
      if (region === 'top') setTopProductOptions([]);
      else if (region === 'middle') setMiddleProductOptions([]);
      else setBottomProductOptions([]);
      return;
    }
    formOptionsAPI.getProducts(detail.line, value)
      .then((opts) => {
        if (region === 'top') setTopProductOptions(opts);
        else if (region === 'middle') setMiddleProductOptions(opts);
        else setBottomProductOptions(opts);
      })
      .catch(() => {
        if (region === 'top') setTopProductOptions([]);
        else if (region === 'middle') setMiddleProductOptions([]);
        else setBottomProductOptions([]);
      });
    setDetail((prev) => ({ ...prev, [`prodc_${region}_product`]: '' }));
  };

  const handleProdcRegionSelect = (region: CRegion) => {
    const next = prodcCopyRegion === region ? null : region;

    if (prodcCopyRegion && prodcCopyRegion !== region) {
      handleDetailSet(`prodc_${prodcCopyRegion}_line`, '');
      handleDetailSet(`prodc_${prodcCopyRegion}_process`, '');
      handleDetailSet(`prodc_${prodcCopyRegion}_product`, '');
      handleProdcProcessChange(prodcCopyRegion, '');
    }

    setProdcCopyRegion(next);
    if (next) {
      handleDetailSet(`prodc_${next}_line`, detail.line);
      handleDetailSet(`prodc_${next}_process`, detail.process_selection);
      handleProdcProcessChange(next, detail.process_selection);
      handleDetailSet(`prodc_${next}_product`, detail.partid_selection);
    }
  };

  const handleRadioChange = (name: keyof DetailFormState, value: string) => {
    setDetail((prev) => ({ ...prev, [name]: value }));
  };

  const handleFlowChange = (id: string, field: keyof Omit<FlowChartRow, 'id'>, value: string) => {
    setDetail((prev) => ({
      ...prev,
      flow_chart: prev.flow_chart.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    }));
  };

  const handleFlowAddRow = () => {
    setDetail((prev) => ({ ...prev, flow_chart: [...prev.flow_chart, makeRow()] }));
  };

  // ===== Date Format Helper =====
  const handleFlowDeleteRow = (id: string) => {
    setDetail((prev) => {
      if (prev.flow_chart.length <= 1) return prev;
      return { ...prev, flow_chart: prev.flow_chart.filter((r) => r.id !== id) };
    });
  };

  // ===== Jayer & Oayer Handlers =====

  const fetchJobFileLayerAndPopulateJayer = async (line: string, process: string) => {
    try {
      const jobFileData = await formOptionsAPI.getJobFileLayer(line, process);

      if (jobFileData && jobFileData.length > 0) {
        const newJayerRows: JayerRow[] = jobFileData.map((item) => {
          const row = {
            ...makeJayerRow(),
            updated: item.updated ? formatUpdatedDate(item.updated) : '',
            process_id: item.processid,
            sp: item.stepseq,
            sd: item.descript,
            pp: item.recipeid,
            layerid: item.layerid || '',
          };
          return { ...row, manuallyDisabled: false, disabled: calcDisabled(row, jayerFilterSets, jayerActiveFilterIds) };
        });
        setJayerRows(newJayerRows);
        addToast(t('request.toast_job_auto_fill', { count: jobFileData.length }), 'info');
      } else {
        addToast(t('request.toast_job_no_data'), 'warning');
      }
    } catch (e) {
      console.error('JOB FILE layer 정보 조회 실패:', e);
      addToast(t('request.toast_job_auto_fill_error'), 'error');
    }
  };

  const fetchOvlLayerAndPopulateOayer = async (line: string, process: string) => {
    try {
      const ovlData = await formOptionsAPI.getOvlLayer(line, process);

      if (ovlData && ovlData.length > 0) {
        const newOayerRows: OayerRow[] = ovlData.map((item) => {
          const row = {
            ...makeOayerRow(),
            updated: item.updated ? formatUpdatedDate(item.updated) : '',
            process_id: item.processid,
            sp: item.stepseq,
            sd: item.descript,
            pp: item.recipeid,
            layerid: item.layerid || '',
          };
          return { ...row, manuallyDisabled: false, disabled: calcDisabled(row, oayerFilterSets, oayerActiveFilterIds) };
        });
        setOayerRows(newOayerRows);
        addToast(t('request.toast_ovl_auto_fill', { count: ovlData.length }), 'info');
      } else {
        addToast(t('request.toast_ovl_no_data'), 'warning');
      }
    } catch (e) {
      console.error('OVL layer 정보 조회 실패:', e);
      addToast(t('request.toast_ovl_auto_fill_error'), 'error');
    }
  };

  const handleJayerChange = (id: string, field: keyof Omit<JayerRow, 'id'>, value: string) => {
    setJayerRows((rows) => rows.map((r) => {
      if (r.id !== id) return r;
      if (field === 'product_name') {
        const next = { ...r, product_name: value, item_id: '' };
        // product_name을 채우면 step이 비어있을 때 layer 값으로 자동 채움(layer 없으면 무동작)
        if (value && !r.step?.trim() && r.layerid?.trim()) next.step = r.layerid;
        return next;
      }
      if (field === 'step') {
        // step 변경 시 캐시된 후보로 item_id 자동매칭 재실행
        const candidates = jayerBarcodeCache[id] ?? [];
        return { ...r, step: value, item_id: autoMatchItemId({ ...r, step: value }, candidates) };
      }
      return { ...r, [field]: value };
    }));
    if (field === 'product_name') {
      if (value) {
        formOptionsAPI.getBarcodeOptions(value).then((options) => {
          setJayerBarcodeCache((prev) => ({ ...prev, [id]: options }));
          // 후보 도착 후 현재 step 기준으로 item_id 자동매칭(1개면 자동, 그 외 빈값)
          setJayerRows((rows) => rows.map((r) => (r.id === id ? { ...r, item_id: autoMatchItemId(r, options) } : r)));
        });
      } else {
        setJayerBarcodeCache((prev) => ({ ...prev, [id]: [] }));
      }
    }
  };

  // 붙여넣기 후 J-layer 자동채움/바코드 조회 연동
  const handleJayerAfterPaste = (changes: { rowId: string; values: Record<string, string> }[]) => {
    changes.forEach(({ rowId, values }) => {
      if ('product_name' in values) {
        const pn = values.product_name;
        if (pn) {
          formOptionsAPI.getBarcodeOptions(pn).then((options) => {
            setJayerBarcodeCache((prev) => ({ ...prev, [rowId]: options }));
            setJayerRows((rows) => rows.map((r) => {
              if (r.id !== rowId) return r;
              let step = r.step;
              if (!step?.trim() && r.layerid?.trim()) step = r.layerid;
              return { ...r, step, item_id: autoMatchItemId({ ...r, step }, options) };
            }));
          });
        } else {
          setJayerBarcodeCache((prev) => ({ ...prev, [rowId]: [] }));
          setJayerRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, item_id: '' } : r)));
        }
      } else if ('step' in values) {
        const candidates = jayerBarcodeCache[rowId] ?? [];
        setJayerRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, item_id: autoMatchItemId(r, candidates) } : r)));
      }
    });
  };

  // 붙여넣기 후 O-layer 자동채움(바코드 없음 — step=layer 자동만)
  const handleOayerAfterPaste = (changes: { rowId: string; values: Record<string, string> }[]) => {
    changes.forEach(({ rowId, values }) => {
      if ('product_name' in values && values.product_name) {
        setOayerRows((rows) => rows.map((r) => {
          if (r.id !== rowId) return r;
          if (!r.step?.trim() && r.layerid?.trim()) return { ...r, step: r.layerid };
          return r;
        }));
      }
    });
  };

  // 엑셀식 셀 선택 + 붙여넣기 (J/O 표 공용 훅). 붙여넣기 후 자동채움/바코드 조회 연동.
  const jayerCellSel = useCellSelection<JayerRow>(jayerRows, setJayerRows, JAYER_EDITABLE_COLS, handleJayerAfterPaste);
  const oayerCellSel = useCellSelection<OayerRow>(oayerRows, setOayerRows, OAYER_EDITABLE_COLS, handleOayerAfterPaste);

  const handleJayerSetAll = (field: 'st' | 'new_or_copy', value: string) => {
    setJayerRows((rows) => rows.map((r) => r.new_or_copy === '기등록' ? r : { ...r, [field]: value }));
  };

  const handleJayerResetField = (field: 'st' | 'new_or_copy') => {
    setJayerRows((rows) => rows.map((r) => r.new_or_copy === '기등록' ? r : { ...r, [field]: '' }));
  };

  const handleJayerAddRow = () => {
    setJayerRows((rows) => [...rows, makeJayerRow()]);
  };

  const handleJayerBulkDisable = () => {
    setJayerRows((rows) =>
      rows.map((r) => (jayerChecked.has(r.id) && !r.disabled ? { ...r, manuallyDisabled: true, disabled: true } : r))
    );
    setSelectedJayerRowId((prev) => (prev && jayerChecked.has(prev) ? null : prev));
    setStagedMappings((prev) => {
      const next = { ...prev };
      jayerChecked.forEach((id) => delete next[id]);
      return next;
    });
    setJayerChecked(new Set());
  };

  const handleJayerBulkRestore = () => {
    setJayerRows((rows) =>
      rows.map((r) => jayerChecked.has(r.id) && r.disabled
        ? { ...r, manuallyDisabled: false, disabled: calcDisabled({ ...r, manuallyDisabled: false }, jayerFilterSets, jayerActiveFilterIds) }
        : r
      )
    );
    setJayerChecked(new Set());
  };

  const handleJayerCheckToggle = (id: string) => {
    setJayerChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleJayerDragStart = (id: string) => {
    // 드래그 선택 모드만 설정한다. 시작 행 토글은 단일 클릭 시 체크박스 onChange가,
    // 드래그 시 handleJayerDragEnter(시작 행 포함 범위)가 처리한다.
    // (여기서 토글하면 onChange와 이중 토글되어 단일 클릭이 먹지 않는 버그가 생긴다.)
    const mode = jayerChecked.has(id) ? 'uncheck' : 'check';
    jayerDragInfo.current = { startId: id, mode };
  };

  const handleJayerDragEnter = (id: string, renderedIds: string[]) => {
    if (!jayerDragInfo.current) return;
    const { startId, mode } = jayerDragInfo.current;
    const startIdx = renderedIds.indexOf(startId);
    const endIdx = renderedIds.indexOf(id);
    if (startIdx === -1 || endIdx === -1) return;
    const [from, to] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    const rangeIds = new Set(renderedIds.slice(from, to + 1));
    setJayerChecked((prev) => {
      const next = new Set(prev);
      rangeIds.forEach((rid) => (mode === 'check' ? next.add(rid) : next.delete(rid)));
      return next;
    });
  };

  const handleJayerCheckAll = () => {
    const activeIds = jayerRows.filter((r) => !r.disabled).map((r) => r.id);
    const allActiveChecked = activeIds.every((id) => jayerChecked.has(id));
    if (allActiveChecked) {
      setJayerChecked(new Set());
    } else {
      setJayerChecked(new Set(activeIds));
    }
  };

  // ===== Oayer Handlers =====
  const handleOayerChange = (id: string, field: keyof Omit<OayerRow, 'id'>, value: string) => {
    setOayerRows((rows) => rows.map((r) => {
      if (r.id !== id) return r;
      if (field === 'product_name') {
        const next = { ...r, product_name: value };
        // product_name을 채우면 step이 비어있을 때 layer 값으로 자동 채움(layer 없으면 무동작)
        if (value && !r.step?.trim() && r.layerid?.trim()) next.step = r.layerid;
        return next;
      }
      return { ...r, [field]: value };
    }));
  };

  const handleOayerSetAll = (field: 'st' | 'new_or_copy', value: string) => {
    setOayerRows((rows) => rows.map((r) => r.new_or_copy === '기등록' ? r : { ...r, [field]: value }));
  };

  const handleOayerResetField = (field: 'st' | 'new_or_copy') => {
    setOayerRows((rows) => rows.map((r) => r.new_or_copy === '기등록' ? r : { ...r, [field]: '' }));
  };

  const handleOayerAddRow = () => {
    setOayerRows((rows) => [...rows, makeOayerRow()]);
  };

  const handleOayerBulkDisable = () => {
    setOayerRows((rows) =>
      rows.map((r) => (oayerChecked.has(r.id) && !r.disabled ? { ...r, manuallyDisabled: true, disabled: true } : r))
    );
    setOayerChecked(new Set());
  };

  const handleOayerBulkRestore = () => {
    setOayerRows((rows) =>
      rows.map((r) => oayerChecked.has(r.id) && r.disabled
        ? { ...r, manuallyDisabled: false, disabled: calcDisabled({ ...r, manuallyDisabled: false }, oayerFilterSets, oayerActiveFilterIds) }
        : r
      )
    );
    setOayerChecked(new Set());
  };

  const handleOayerCheckToggle = (id: string) => {
    setOayerChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleOayerDragStart = (id: string) => {
    // 드래그 선택 모드만 설정한다(시작 행 토글은 onChange/handleOayerDragEnter가 처리).
    const mode = oayerChecked.has(id) ? 'uncheck' : 'check';
    oayerDragInfo.current = { startId: id, mode };
  };

  const handleOayerDragEnter = (id: string, renderedIds: string[]) => {
    if (!oayerDragInfo.current) return;
    const { startId, mode } = oayerDragInfo.current;
    const startIdx = renderedIds.indexOf(startId);
    const endIdx = renderedIds.indexOf(id);
    if (startIdx === -1 || endIdx === -1) return;
    const [from, to] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    const rangeIds = new Set(renderedIds.slice(from, to + 1));
    setOayerChecked((prev) => {
      const next = new Set(prev);
      rangeIds.forEach((rid) => (mode === 'check' ? next.add(rid) : next.delete(rid)));
      return next;
    });
  };

  const handleOayerCheckAll = () => {
    const activeIds = oayerRows.filter((r) => !r.disabled).map((r) => r.id);
    const allActiveChecked = activeIds.every((id) => oayerChecked.has(id));
    if (allActiveChecked) {
      setOayerChecked(new Set());
    } else {
      setOayerChecked(new Set(activeIds));
    }
  };

  // ===== Layer 추가/삭제 Handlers =====
  const handleRefDocSelect = async (label: string) => {
    const doc = approvedDocs.find((d) => d.title === label);
    if (!doc) {
      setRefDocId(null);
      setRefJayerRows([]);
      setRefOayerRows([]);
      return;
    }
    setRefDocId(doc.id);
    try {
      const res = await documentsAPI.get(doc.id);
      const parsed = JSON.parse(res.data.additional_notes ?? '{}');
      setRefJayerRows(parsed.jayerRows ?? []);
      setRefOayerRows(parsed.oayerRows ?? []);
    } catch {
      setRefJayerRows([]);
      setRefOayerRows([]);
      addToast('요청서 데이터 로드 실패', 'error');
    }
  };

  const handleMergeClick = () => {
    const makeKey = (r: { process_id: string; sp: string; sd: string; pp: string }) =>
      `${r.process_id}||${r.sp}||${r.sd}||${r.pp}`;

    const activeJayerKeys = new Set(jayerRows.filter((r) => !r.disabled).map(makeKey));
    const activeRefJayerKeys = new Set(refJayerRows.filter((r) => !r.disabled).map(makeKey));
    const jayerMatched = [...activeJayerKeys].filter((k) => activeRefJayerKeys.has(k)).length;
    const jayerUnmatchedRef = [...activeRefJayerKeys].filter((k) => !activeJayerKeys.has(k)).length;

    const activeOayerKeys = new Set(oayerRows.filter((r) => !r.disabled).map(makeKey));
    const activeRefOayerKeys = new Set(refOayerRows.filter((r) => !r.disabled).map(makeKey));
    const oayerMatched = [...activeOayerKeys].filter((k) => activeRefOayerKeys.has(k)).length;
    const oayerUnmatchedRef = [...activeRefOayerKeys].filter((k) => !activeOayerKeys.has(k)).length;

    setMergeStats({ jayerMatched, jayerUnmatchedRef, oayerMatched, oayerUnmatchedRef });
    setMergeConfirmOpen(true);
  };

  const handleMergeConfirm = () => {
    const makeKey = (r: { process_id: string; sp: string; sd: string; pp: string }) =>
      `${r.process_id}||${r.sp}||${r.sd}||${r.pp}`;

    const refJayerKeyMap = new Map<string, JayerRow>();
    refJayerRows.filter((r) => !r.disabled).forEach((r) => refJayerKeyMap.set(makeKey(r), r));
    const activeJayerKeys = new Set(jayerRows.filter((r) => !r.disabled).map(makeKey));

    const mergedJayer: JayerRow[] = jayerRows.map((r) => {
      if (!r.disabled && refJayerKeyMap.has(makeKey(r))) {
        return { ...r, st: 'X', new_or_copy: '기등록' };
      }
      return r;
    });
    refJayerRows.filter((r) => !r.disabled).forEach((r) => {
      if (!activeJayerKeys.has(makeKey(r))) {
        mergedJayer.push({ ...r, id: genId(), sortOrder: Date.now() });
      }
    });
    setJayerRows(mergedJayer);

    const refOayerKeyMap = new Map<string, OayerRow>();
    refOayerRows.filter((r) => !r.disabled).forEach((r) => refOayerKeyMap.set(makeKey(r), r));
    const activeOayerKeys = new Set(oayerRows.filter((r) => !r.disabled).map(makeKey));

    const mergedOayer: OayerRow[] = oayerRows.map((r) => {
      if (!r.disabled && refOayerKeyMap.has(makeKey(r))) {
        return { ...r, st: 'X', new_or_copy: '기등록' };
      }
      return r;
    });
    refOayerRows.filter((r) => !r.disabled).forEach((r) => {
      if (!activeOayerKeys.has(makeKey(r))) {
        mergedOayer.push({ ...r, id: genId(), sortOrder: Date.now() });
      }
    });
    setOayerRows(mergedOayer);

    setMergeConfirmOpen(false);
    addToast(t('request.toast_merge_complete', { jayerMatched: mergeStats!.jayerMatched, oayerMatched: mergeStats!.oayerMatched, unmatched: mergeStats!.jayerUnmatchedRef + mergeStats!.oayerUnmatchedRef }), 'success');
  };

  // ===== Bb Entry Handlers (Step 1 - 뼈찜 조합 영역 다중 행) =====
  const handleBbEntryChange = (idx: number, field: 'location' | 'product' | 'process_id', value: string) => {
    setDetail((prev) => ({
      ...prev,
      bb_entries: prev.bb_entries.map((e, i) => (i === idx ? { ...e, [field]: value } : e)),
    }));

    if (field === 'process_id' && value) {
      const updatedEntry = { ...detail.bb_entries[idx], process_id: value };
      formOptionsAPI.getBbExternalData(updatedEntry)
        .then((result) => {
          if (result.length > 0) {
            addToast(t('request.toast_bb_auto_fill', { count: result.length }), 'info');
          } else {
            addToast(t('request.toast_bb_no_data'), 'warning');
          }
        })
        .catch(() => {
          addToast(t('request.toast_bb_error'), 'error');
        });
    }
  };

  const handleBbEntryAdd = () => {
    setDetail((prev) => ({
      ...prev,
      bb_entries: [...prev.bb_entries, { location: '', product: '', process_id: '' }],
    }));
  };

  const handleBbEntryDelete = (idx: number) => {
    setDetail((prev) => {
      if (prev.bb_entries.length <= 1) return prev;
      return { ...prev, bb_entries: prev.bb_entries.filter((_, i) => i !== idx) };
    });
  };

  // ===== Bb Handlers =====
  const handleBbChange = (
    id: string,
    field: keyof Omit<BbTableRow, 'id'>,
    value: string
  ) => {
    setBbRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const handleBbAddRow = () => {
    setBbRows((rows) => [...rows, makeBbRow()]);
  };

  const handleBbBulkDelete = () => {
    const rowsToRestore = bbRows.filter((r) =>
      bbChecked.has(r.id) && r.sourceJayerRowId
    );

    setBbRows((rows) => rows.filter((r) => !bbChecked.has(r.id)));

    setMappedJayerRowIds((prev) => {
      const next = new Set(prev);
      rowsToRestore.forEach((row) => {
        if (row.sourceJayerRowId) next.delete(row.sourceJayerRowId);
      });
      return next;
    });

    setBbChecked(new Set());
  };

  const handleBbCheckToggle = (id: string) => {
    setBbChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBbCheckAll = () => {
    if (bbChecked.size === bbRows.length) {
      setBbChecked(new Set());
    } else {
      setBbChecked(new Set(bbRows.map((r) => r.id)));
    }
  };

  // 오른쪽 외부 데이터 클릭 → 선택된 J-ayer 행에 스테이징 (즉시 적용 X)
  const handleStageMapping = (externalRow: ExternalBbDataItem) => {
    if (!selectedJayerRowId) return;
    setStagedMappings((prev) => ({ ...prev, [selectedJayerRowId]: externalRow }));
  };

  // 스테이징 취소
  const handleClearStaging = (jayerRowId: string) => {
    setStagedMappings((prev) => {
      const next = { ...prev };
      delete next[jayerRowId];
      return next;
    });
  };

  const handleApplyMappings = () => {
    const mappedRows: BbTableRow[] = jayerRows
      .filter((jr) => !jr.disabled && stagedMappings[jr.id])
      .map((jr) => {
        const ext = stagedMappings[jr.id];
        const newRow = makeBbRow();
        newRow.sourceJayerRowId = jr.id;
        newRow.process_id = jr.process_id;
        newRow.ss = jr.sp;
        newRow.sd = jr.sd;
        newRow.bb_process_id = ext.bb_process_id;
        newRow.bb_name = ext.bb_name;
        // 자동 채움(buildAutoFillRows)과 동일하게 layer 컬럼을 외부 데이터의 layerid로 채운다.
        newRow.bb_step = ext.layerid ?? '';
        newRow.bb_ss = ext.bb_ss;
        return newRow;
      });
    if (mappedRows.length === 0) return;

    setBbRows((prev) => [...prev, ...mappedRows]);
    setMappedJayerRowIds((prev) => {
      const next = new Set(prev);
      mappedRows.forEach((row) => {
        if (row.sourceJayerRowId) next.add(row.sourceJayerRowId);
      });
      return next;
    });
    setStagedMappings({});
    setSelectedJayerRowId(null);
  };

  const handleOpenAutoFillPanel = () => {
    const layerIds = [...new Set(jayerRows.filter(r => !r.disabled).map(r => r.layerid).filter(Boolean))]
      .sort((a, b) => parseFloat(a) - parseFloat(b));

    const productIds = detail.bb_entries.map(e => e.product).filter(Boolean);

    if (layerIds.length > 0 && productIds.length > 0) {
      setBbAutoFillRanges([{
        id: String(Date.now()),
        layerFrom: layerIds[0],
        layerTo: layerIds[layerIds.length - 1],
        productId: productIds[0],
      }]);
    } else {
      setBbAutoFillRanges([]);
    }
    setShowAutoFillPanel(true);
  };

  const handleAddRange = () => {
    const productIds = detail.bb_entries.map(e => e.product).filter(Boolean);
    setBbAutoFillRanges(prev => [
      ...prev,
      {
        id: String(Date.now()),
        layerFrom: '',
        layerTo: '',
        productId: productIds[0] || '',
      },
    ]);
  };

  const handleRemoveRange = (id: string) => {
    setBbAutoFillRanges(prev => prev.filter(r => r.id !== id));
  };

  const handleRangeChange = (id: string, field: keyof BbAutoFillRange, value: string) => {
    setBbAutoFillRanges(prev => prev.map(r =>
      r.id === id ? { ...r, [field]: value } : r
    ));
  };

  const buildAutoFillRows = (): BbTableRow[] => {
    const newBbRows: BbTableRow[] = [];
    bbAutoFillRanges.forEach(range => {
      if (!range.layerFrom || !range.layerTo || !range.productId) return;
      const from = parseFloat(range.layerFrom);
      const to = parseFloat(range.layerTo);
      if (isNaN(from) || isNaN(to)) return;

      const jayerRowsInRange = jayerRows.filter(row => {
        const layer = parseFloat(row.layerid);
        return !row.disabled && !isNaN(layer) && layer >= from && layer <= to;
      });

      const entryIdx = detail.bb_entries.findIndex(e => e.product === range.productId);
      if (entryIdx === -1) return;

      const photoSteps = bbExternalData[entryIdx] ?? [];
      jayerRowsInRange.forEach(jayerRow => {
        const matchedStep = photoSteps.find(step => step.layerid === jayerRow.layerid);
        if (!matchedStep) return;
        newBbRows.push({
          id: genId(),
          sourceJayerRowId: jayerRow.id,
          sortOrder: jayerRow.sortOrder,
          disabled: jayerRow.disabled,
          process_id: jayerRow.process_id,
          ss: jayerRow.sp,
          sd: jayerRow.sd,
          bb_process_id: matchedStep.processid,
          bb_name: range.productId,
          bb_step: matchedStep.layerid,
          bb_ss: matchedStep.stepseq,
          remark: '',
        });
      });
    });
    return newBbRows;
  };

  const applyBbRowChanges = (
    rowsToReplace: BbTableRow[],
    existingRowIdsToRemove: string[],
    rowsToAdd: BbTableRow[]
  ) => {
    const removeSet = new Set(existingRowIdsToRemove);
    setBbRows(prev => {
      const removedSourceIds = prev
        .filter(r => removeSet.has(r.id) && r.sourceJayerRowId)
        .map(r => r.sourceJayerRowId as string);

      setMappedJayerRowIds(prevMapped => {
        const next = new Set(prevMapped);
        removedSourceIds.forEach(id => next.delete(id));
        [...rowsToReplace, ...rowsToAdd].forEach(r => {
          if (r.sourceJayerRowId) next.add(r.sourceJayerRowId);
        });
        return next;
      });

      return [
        ...prev.filter(r => !removeSet.has(r.id)),
        ...rowsToReplace,
        ...rowsToAdd,
      ];
    });
    setShowAutoFillPanel(false);
    setBbAutoFillRanges([]);
    const total = rowsToReplace.length + rowsToAdd.length;
    addToast(`Backbone 데이터가 ${total}행 자동 채워졌습니다.`, 'success');
  };

  const handleApplyAutoFill = () => {
    const allNewRows = buildAutoFillRows();
    if (allNewRows.length === 0) {
      addToast('매칭된 Backbone 데이터가 없습니다.', 'error');
      return;
    }

    const newLayerIds = new Set(allNewRows.map(r => r.bb_step).filter(Boolean));
    const conflictingExisting = bbRows.filter(r => r.bb_step && newLayerIds.has(r.bb_step));

    if (conflictingExisting.length === 0) {
      applyBbRowChanges([], [], allNewRows);
      return;
    }

    const duplicateLayerIds = [...new Set(conflictingExisting.map(r => r.bb_step))].sort(
      (a, b) => parseFloat(a) - parseFloat(b)
    );
    const conflictLayerSet = new Set(duplicateLayerIds);
    const rowsToReplace = allNewRows.filter(r => conflictLayerSet.has(r.bb_step));
    const rowsToAdd = allNewRows.filter(r => !conflictLayerSet.has(r.bb_step));
    const existingRowIdsToRemove = conflictingExisting.map(r => r.id);

    setBbConflictState({ duplicateLayerIds, rowsToAdd, rowsToReplace, existingRowIdsToRemove });
  };

  const handleResetBbRows = () => {
    setBbResetConfirm(true);
  };

  const proceedResetBbRows = () => {
    setBbRows([]);
    setMappedJayerRowIds(new Set());
    addToast('Backbone 데이터가 초기화되었습니다.', 'info');
  };

  const handleFilterDeleteConfirm = () => {
    if (!filterDeleteConfirm) return;
    const { type, filterId, label } = filterDeleteConfirm;
    if (type === 'jayer') {
      const updated = jayerFilterSets.filter(f => f.id !== filterId);
      const nextActive = new Set(jayerActiveFilterIds);
      nextActive.delete(filterId);
      setJayerFilterSets(updated);
      setJayerActiveFilterIds(nextActive);
      localStorage.setItem('jayerFilterSets', JSON.stringify(updated));
      setJayerRows(rows => rows.map(r => ({ ...r, disabled: calcDisabled(r, updated, nextActive) })));
    } else {
      const updated = oayerFilterSets.filter(f => f.id !== filterId);
      const nextActive = new Set(oayerActiveFilterIds);
      nextActive.delete(filterId);
      setOayerFilterSets(updated);
      setOayerActiveFilterIds(nextActive);
      localStorage.setItem('oayerFilterSets', JSON.stringify(updated));
      setOayerRows(rows => rows.map(r => ({ ...r, disabled: calcDisabled(r, updated, nextActive) })));
    }
    addToast(`필터 "${label}"이 삭제되었습니다.`, 'info');
  };

  const handleFilterAllDeleteConfirm = () => {
    if (!filterAllDeleteConfirm) return;
    if (filterAllDeleteConfirm === 'jayer') {
      setJayerFilterSets([]);
      setJayerActiveFilterIds(new Set());
      localStorage.removeItem('jayerFilterSets');
      setJayerRows(rows => rows.map(r => ({ ...r, disabled: r.manuallyDisabled })));
    } else {
      setOayerFilterSets([]);
      setOayerActiveFilterIds(new Set());
      localStorage.removeItem('oayerFilterSets');
      setOayerRows(rows => rows.map(r => ({ ...r, disabled: r.manuallyDisabled })));
    }
    addToast('모든 필터가 삭제되었습니다.', 'info');
  };

  const handleSortBbRows = () => {
    setBbRows(prev => {
      const sorted = [...prev].sort((a, b) =>
        a.ss.localeCompare(b.ss, undefined, { numeric: true })
      );
      return sorted;
    });
  };

  // ===== Validation =====
  const validate = (currentStep: number): { valid: boolean; errors: string[] } => {
    const newErrors: Partial<Record<string, string>> = {};
    const errorMessages: string[] = [];

    if (currentStep === 1) {
      DETAIL_REQUIRED.forEach((field) => {
        const val = detail[field] as string;
        if (!val?.trim()) {
          newErrors[field] = t('request.required');
          errorMessages.push(`${field}: 필수 입력 항목입니다.`);
        }
      });
      // Only MAP 모드에서는 Backbone 조합 영역 필수 검증을 우회한다.
      if (!isOnlyMap) {
        const filledBb = detail.bb_entries.filter(
          (e) => e.location?.trim() && e.product?.trim() && e.process_id?.trim()
        );
        if (filledBb.length === 0) {
          newErrors['bb_entries'] = t('request.required');
          errorMessages.push('Backbone 조합 영역: 최소 1개 이상 입력해야 합니다.');
        }
      }
    }

    if (currentStep === 2) {
      if (!detail.map_type?.trim()) {
        newErrors['map_type'] = t('request.required');
        errorMessages.push('MAP 요청 목적: 필수 입력 항목입니다.');
      }
      if (!isMapRegistered) {
      if (detail.only_prodc === 'Yes') {
        // C가문 Yes: top/bottom X/Y 필수 + 부호·동일값 검증
        if (!detail.map_value_x_top?.trim()) {
          newErrors['map_value_x_top'] = t('request.required');
          errorMessages.push('MAP 변경 X (북쪽): 필수 입력 항목입니다.');
        }
        if (!detail.map_value_y_top?.trim()) {
          newErrors['map_value_y_top'] = t('request.required');
          errorMessages.push('MAP 변경 Y (북쪽): 필수 입력 항목입니다.');
        }
        if (!detail.map_value_x_bottom?.trim()) {
          newErrors['map_value_x_bottom'] = t('request.required');
          errorMessages.push('MAP 변경 X (남쪽): 필수 입력 항목입니다.');
        }
        if (!detail.map_value_y_bottom?.trim()) {
          newErrors['map_value_y_bottom'] = t('request.required');
          errorMessages.push('MAP 변경 Y (남쪽): 필수 입력 항목입니다.');
        }
        if (!detail.map_reason?.trim()) {
          newErrors['map_reason'] = t('request.required');
          errorMessages.push('MAP 변경 사유: 필수 입력 항목입니다.');
        }
        // X값 부호 반대 + 절대값 동일 검증
        if (detail.map_value_x_top?.trim() && detail.map_value_x_bottom?.trim()) {
          const xTop = parseFloat(detail.map_value_x_top);
          const xBot = parseFloat(detail.map_value_x_bottom);
          if (!isNaN(xTop) && !isNaN(xBot)) {
            if (Math.abs(xTop) !== Math.abs(xBot) || Math.sign(xTop) === Math.sign(xBot)) {
              newErrors['map_value_x_bottom'] = t('request.map_x_sign_error');
              errorMessages.push(t('request.map_x_sign_error'));
            }
          }
        }
        // Y값 동일 검증
        if (detail.map_value_y_top?.trim() && detail.map_value_y_bottom?.trim()) {
          if (detail.map_value_y_top.trim() !== detail.map_value_y_bottom.trim()) {
            newErrors['map_value_y_bottom'] = t('request.map_y_equal_error');
            errorMessages.push(t('request.map_y_equal_error'));
          }
        }
      } else if (detail.map_change === '변경 있음') {
        if (!detail.map_value_x?.trim()) {
          newErrors['map_value_x'] = t('request.required');
          errorMessages.push('MAP 변경 X: 필수 입력 항목입니다.');
        }
        if (!detail.map_value_y?.trim()) {
          newErrors['map_value_y'] = t('request.required');
          errorMessages.push('MAP 변경 Y: 필수 입력 항목입니다.');
        }
        if (!detail.map_reason?.trim()) {
          newErrors['map_reason'] = t('request.required');
          errorMessages.push('MAP 변경 사유: 필수 입력 항목입니다.');
        }
      }
      if (detail.ea_change === '변경 있음') {
        if (!detail.ea_value?.trim()) {
          newErrors['ea_value'] = t('request.required');
          errorMessages.push('예외 구역 값: 필수 입력 항목입니다.');
        }
      }
      if (detail.only_prodc === 'Yes') {
        (['top', 'bottom'] as const).forEach((region) => {
          if (!detail[`prodc_${region}_line` as keyof DetailFormState]?.toString().trim()) {
            newErrors[`prodc_${region}_line`] = t('request.required');
            errorMessages.push(`C가문 ${region === 'top' ? '북쪽' : '남쪽'} 위치: 필수 입력 항목입니다.`);
          }
          if (!detail[`prodc_${region}_process` as keyof DetailFormState]?.toString().trim()) {
            newErrors[`prodc_${region}_process`] = t('request.required');
            errorMessages.push(`C가문 ${region === 'top' ? '북쪽' : '남쪽'} 조합법: 필수 입력 항목입니다.`);
          }
          if (!detail[`prodc_${region}_product` as keyof DetailFormState]?.toString().trim()) {
            newErrors[`prodc_${region}_product`] = t('request.required');
            errorMessages.push(`C가문 ${region === 'top' ? '북쪽' : '남쪽'} 제품: 필수 입력 항목입니다.`);
          }
        });
      }
      if (detail.mshot_change === '추가' || detail.mshot_change === '수정') {
        if (detail.only_prodc === 'Yes') {
          if (!detail.mshot_image_copy_top) {
            newErrors['mshot_image_copy_top'] = t('request.required');
            errorMessages.push('X표시 이미지 (북쪽): 필수 입력 항목입니다.');
          }
          if (!detail.mshot_image_copy_bottom) {
            newErrors['mshot_image_copy_bottom'] = t('request.required');
            errorMessages.push('X표시 이미지 (남쪽): 필수 입력 항목입니다.');
          }
        } else {
          if (!detail.mshot_image_copy) {
            newErrors['mshot_image_copy'] = t('request.required');
            errorMessages.push('X표시 이미지: 필수 입력 항목입니다.');
          }
        }
      }
      } // end !isMapRegistered
    }

    // step 3(J-layer)·step 4 O-layer 행은 의도적으로 행 단위 필수값 검증을 두지 않는다(행은 선택사항).
    // 상신 시 step 5의 "활성 + process_id 있는 J-layer 행은 Bb 매핑 필수" 규칙으로 간접 검증된다.

    if (currentStep === 4) {
      if (!detail.partial_shot?.trim()) {
        newErrors['partial_shot'] = t('request.required');
        errorMessages.push('Partial Shot 계측 필요: 필수 선택 항목입니다.');
      }
    }

    if (currentStep === 5) {
      const unmappedJayerRows = jayerRows.filter(
        (row) => !row.disabled && row.process_id && !mappedJayerRowIds.has(row.id)
      );
      if (unmappedJayerRows.length > 0) {
        newErrors['jayer_mapping'] = '모든 원본 데이터에 Backbone을 매핑해야 상신할 수 있습니다.';
        errorMessages.push('모든 원본 데이터에 Backbone을 매핑해야 상신할 수 있습니다.');
      }
    }

    setErrors(newErrors);
    return { valid: Object.keys(newErrors).length === 0, errors: errorMessages };
  };

  // ===== API =====
  const buildEnrichedForm = (note?: string, shouldAddHistory = false, isDraft = false): CreateDocumentInput => {
    const now = new Date();
    const dateStr = `${String(now.getFullYear()).slice(2)}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const purposePart = detail.other_purpose ? `${detail.request_purpose}-${detail.other_purpose}` : detail.request_purpose;
    const title = `${detail.line}(${purposePart})_MAP(${detail.map_type})_${detail.process_selection}_${detail.partid_selection}_${detail.process_id}_요청서_${dateStr}`;

    // 반려된 문서 재상신 시 이전 스냅샷을 history 에 누적
    let history: HistorySnapshot[] = [];
    if (shouldAddHistory && prevParsedRef.current) {
      const prev = prevParsedRef.current;
      history = [
        ...prev.history,
        {
          timestamp: new Date().toISOString(),
          detail: prev.detail as DetailFormState,
          jayerRows: prev.jayerRows,
          oayerRows: prev.oayerRows,
          bbRows: prev.bbRows,
        },
      ];
    }

    return {
      ...form,
      title,
      product_name: detail.partid_selection,
      requester_name: currentUser.name,
      requester_email: currentUser.email,
      requester_department: currentUser.department,
      production_date: productionDate || null,
      reference_materials: note ?? '',
      additional_notes: JSON.stringify({
        detail,
        jayerRows: (isDraft ? jayerRows : jayerRows.filter(r => !r.disabled)).sort((a, b) => jayerSortBySp ? a.sp.localeCompare(b.sp) : a.sortOrder - b.sortOrder),
        oayerRows: (isDraft ? oayerRows : oayerRows.filter(r => !r.disabled)).sort((a, b) => oayerSortBySp ? a.sp.localeCompare(b.sp) : a.sortOrder - b.sortOrder),
        bbRows,
        history,
        jayerActiveFilterIds: [...jayerActiveFilterIds],
        oayerActiveFilterIds: [...oayerActiveFilterIds],
      }),
    };
  };

  const handleSaveDraft = async () => {
    if (isPersistingRef.current) return;
    isPersistingRef.current = true;
    setSaving(true);
    try {
      const enriched = buildEnrichedForm(undefined, false, true);
      if (savedId) {
        await documentsAPI.update(savedId, enriched);
      } else {
        const res = await documentsAPI.create(enriched);
        setSavedId(res.data.id);
      }
      addToast(t('request.save_success'), 'success');
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setSaving(false);
      isPersistingRef.current = false;
    }
  };

  const handleIdleAutoSave = async () => {
    if (!detail.line || !detail.partid_selection || !detail.process_selection || !detail.process_id) return;
    // 수동 저장/상신이 진행 중이면 중복 create 방지를 위해 자동저장을 건너뛴다
    if (isPersistingRef.current) return;
    isPersistingRef.current = true;
    try {
      const enriched = buildEnrichedForm(undefined, false, true);
      if (savedId) {
        await documentsAPI.update(savedId, enriched);
      } else {
        const res = await documentsAPI.create(enriched);
        setSavedId(res.data.id);
      }
      addToast(t('request.auto_save_success'), 'info');
    } catch {
      // 자동저장 실패는 조용히 무시
    } finally {
      isPersistingRef.current = false;
    }
  };

  useIdleTimer(handleIdleAutoSave, 20 * 60 * 1000);

  // 검증 실패 시 첫 번째 오류 필드로 스크롤·강조한다.
  // O-layer(step 4)의 partial_shot 오류는 'info' 탭에 있으므로 먼저 탭을 전환한다.
  const scrollToFirstError = () => {
    if (step === 4) setOayerInfoTab('info');
    // 탭 전환·에러 span 렌더가 끝난 뒤 DOM을 조회하도록 지연한다.
    setTimeout(() => {
      const errorEl = document.querySelector('.form-error');
      if (!errorEl) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const container = (errorEl.closest('.form-group') ?? errorEl.parentElement ?? errorEl) as HTMLElement;
      container.scrollIntoView({ behavior: 'smooth', block: 'center' });
      container.classList.add('field-error-flash');
      setTimeout(() => container.classList.remove('field-error-flash'), 1600);
      const focusable = container.querySelector('input, select, textarea, button') as HTMLElement | null;
      focusable?.focus({ preventScroll: true });
    }, 60);
  };

  const handleNextStep = (skipTbvtlvWarn = false, skipSpecialCare = false) => {
    if (step === 1 || step === 2 || step === 4) {
      const result = validate(step);
      if (!result.valid) {
        result.errors.forEach(msg => addToast(msg, 'error'));
        scrollToFirstError();
        return;
      }
    }
    if (step === 1 && !detail.customer_requirement.trim() && !skipSpecialCare) {
      setSpecialCareConfirm(true);
      return;
    }
    if (step === 4 && !skipTbvtlvWarn) {
      const hasTbvtlvActive = oayerRows.some(
        r => !r.disabled && (r.sd.toUpperCase().includes('TBV') || r.sd.toUpperCase().includes('TLV'))
      );
      if (hasTbvtlvActive) {
        const thicknessEmpty = !detail.tbvtlv_thickness.trim();
        const entriesEmpty = (detail.tbvtlv_entries ?? []).length === 0;
        if (thicknessEmpty || entriesEmpty) {
          setTbvtlvWarnModal(true);
          return;
        }
      }
    }
    setStep((s) => s + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePrevStep = () => {
    setStep((s) => s - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleReset = () => {
    setDetail(prev => ({
      ...prev,
      map_type: INITIAL_DETAIL.map_type,
      source_line: INITIAL_DETAIL.source_line,
      source_partid: INITIAL_DETAIL.source_partid,
      map_change: INITIAL_DETAIL.map_change,
      map_value_x: INITIAL_DETAIL.map_value_x,
      map_value_y: INITIAL_DETAIL.map_value_y,
      map_reason: INITIAL_DETAIL.map_reason,
      map_change_top: INITIAL_DETAIL.map_change_top,
      map_value_x_top: INITIAL_DETAIL.map_value_x_top,
      map_value_y_top: INITIAL_DETAIL.map_value_y_top,
      map_change_bottom: INITIAL_DETAIL.map_change_bottom,
      map_value_x_bottom: INITIAL_DETAIL.map_value_x_bottom,
      map_value_y_bottom: INITIAL_DETAIL.map_value_y_bottom,
      ea_change: INITIAL_DETAIL.ea_change,
      ea_value: INITIAL_DETAIL.ea_value,
      only_prodc: INITIAL_DETAIL.only_prodc,
      prodc_top_line: INITIAL_DETAIL.prodc_top_line,
      prodc_top_process: INITIAL_DETAIL.prodc_top_process,
      prodc_top_product: INITIAL_DETAIL.prodc_top_product,
      prodc_middle_use: INITIAL_DETAIL.prodc_middle_use,
      prodc_middle_line: INITIAL_DETAIL.prodc_middle_line,
      prodc_middle_process: INITIAL_DETAIL.prodc_middle_process,
      prodc_middle_product: INITIAL_DETAIL.prodc_middle_product,
      prodc_bottom_line: INITIAL_DETAIL.prodc_bottom_line,
      prodc_bottom_process: INITIAL_DETAIL.prodc_bottom_process,
      prodc_bottom_product: INITIAL_DETAIL.prodc_bottom_product,
      mshot_change: INITIAL_DETAIL.mshot_change,
      mshot_image_copy: INITIAL_DETAIL.mshot_image_copy,
      mshot_image_copy_top: INITIAL_DETAIL.mshot_image_copy_top,
      mshot_image_copy_bottom: INITIAL_DETAIL.mshot_image_copy_bottom,
      photo_backside: INITIAL_DETAIL.photo_backside,
      eds_backside: INITIAL_DETAIL.eds_backside,
      inter: INITIAL_DETAIL.inter,
      tsv: INITIAL_DETAIL.tsv,
      rf: INITIAL_DETAIL.rf,
      fullchip: INITIAL_DETAIL.fullchip,
      split: INITIAL_DETAIL.split,
      st: INITIAL_DETAIL.st,
      ecc: INITIAL_DETAIL.ecc,
      labelsideshot: INITIAL_DETAIL.labelsideshot,
      hpkglabelheight: INITIAL_DETAIL.hpkglabelheight,
      rev_yn: INITIAL_DETAIL.rev_yn,
      rev_entries: INITIAL_DETAIL.rev_entries,
      partial_shot: INITIAL_DETAIL.partial_shot,
      tbvtlv_thickness: INITIAL_DETAIL.tbvtlv_thickness,
      tbvtlv_entries: INITIAL_DETAIL.tbvtlv_entries,
    }));
    setErrors({});
    setProdcCopyRegion(null);
    setRevLayersSelected([]);
    setRevGds('');
  };

  const handleSubmitClick = async () => {
    const result = validate(5);
    if (!result.valid) {
      result.errors.forEach(msg => addToast(msg, 'error'));
      scrollToFirstError();
      return;
    }
    // peer review 모드가 아닐 때만 PL 목록 로드
    if (!isPeerReviewMode && plUserOptions.length === 0) {
      try {
        const res = await usersAPI.list('PL');
        setPlUserOptions(res.data.filter(u => u.loginid !== currentUser.username));
      } catch {
        setPlUserOptions([]);
      }
    }
    setDesigneeLoginid('');
    setDesigneeName('');
    setDesigneeSearchQuery('');
    setDesigneeError('');
    setConfirmOpen(true);
  };

  const handleSubmit = async () => {
    // peer review 모드 외 일반 상신: 지정자 필수
    if (!isPeerReviewMode && !designeeLoginid) {
      setDesigneeError(t('request.designee_required'));
      return;
    }
    if (isPersistingRef.current) return;
    isPersistingRef.current = true;
    setSubmitting(true);
    try {
      let docId = savedId;

      const enriched = buildEnrichedForm(submitNote, false);
      if (!docId) {
        const res = await documentsAPI.create(enriched);
        docId = res.data.id;
        setSavedId(docId);
      } else {
        await documentsAPI.update(docId, enriched);
      }

      if (isPeerReviewMode) {
        // 지정 PL 수정 후 상신
        const enrichedWithHistory = buildEnrichedForm(submitNote, true);
        await documentsAPI.update(docId!, enrichedWithHistory);
        await documentsAPI.peerSubmit(docId!, submitNote || undefined);
        addToast('수정 후 상신되었습니다.', 'success');
      } else {
        const doc = await documentsAPI.get(docId!);
        const isRejected = doc.data.status === 'rejected';

        if (isRejected) {
          const enrichedWithHistory = buildEnrichedForm(submitNote, true);
          await documentsAPI.update(docId!, enrichedWithHistory);
          await documentsAPI.resubmit(docId!, designeeLoginid);
          addToast('재상신되었습니다.', 'success');
        } else {
          const submitRes = await documentsAPI.submit(docId!, designeeLoginid);
          addToast(t('request.submit_success'), 'success');
          if (submitRes.data.email_sent) {
            setTimeout(() => addToast(t('request.messenger_sent_to_manager'), 'info'), 800);
          }
        }
      }
      setTimeout(() => navigate('/approval'), 1500);
    } catch (err) {
      addToast(`오류 발생: ${err instanceof Error ? err.message : '알 수 없는 오류'}`, 'error');
    } finally {
      setSubmitting(false);
      isPersistingRef.current = false;
    }
  };

  // ===== Guide helpers =====
  const toggleSlidePanel = (featureKey: GuideFeatureKey, title: string) => {
    setSlidePanel((prev) =>
      prev.open && prev.featureKey === featureKey
        ? { ...prev, open: false }
        : { open: true, featureKey, title }
    );
  };

  // 가이드 배지는 <label> 안에 위치하는 경우가 많다. <button> 으로 두면 label 의
  // "연결된 컨트롤"이 되어 label(행) 아무 곳이나 클릭해도 가이드가 열린다.
  // labelable 이 아닌 <span role="button"> 으로 렌더해 배지를 직접 클릭할 때만 열리게 한다.
  // 빌트인 데모가 있는 기능은 '영상 가이드' 배지로 구분한다.
  const GuideBadge = ({ fk, tk }: { fk: GuideFeatureKey; tk: string }) => {
    if (!featureGuideKeys.has(fk)) return null;
    const isVideo = GUIDE_DEMO_KEYS.includes(fk);
    const active = slidePanel.open && slidePanel.featureKey === fk;
    const open = (e: React.SyntheticEvent) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSlidePanel(fk, tk);
    };
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') open(e); }}
        className={`${isVideo ? 'guide-video-badge' : 'guide-badge'}${active ? ' active' : ''}`}
      >
        {t(isVideo ? 'guide.video_btn' : 'guide.guide_btn')}
      </span>
    );
  };

  // ===== Main Render =====
  return (
    <div className="container page">
      <div className="page-header">
        <h1>{isPeerReviewMode ? '의뢰서 수정·재상신' : isEditMode ? '의뢰서 수정·재상신' : t('request.title')}</h1>
        <p>{isPeerReviewMode || isEditMode ? '내용을 수정한 후 재상신하면 반려 단계부터 다시 검토됩니다.' : t('request.subtitle')}</p>
      </div>
      {isPeerReviewMode && (
        <div style={{ background: 'var(--warning-light)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-sm)', padding: '10px 16px', marginBottom: 16, color: 'var(--warning)', fontSize: '0.9rem', fontWeight: 500 }}>
          🟡 {t('request.peer_review_banner')}
        </div>
      )}

      <WizardIndicator
        currentStep={step}
        steps={[
          t('request.section_detail'),
          t('request.section_map'),
          t('request.job_li'),
          t('request.ovl_li'),
          t('request.bb_li'),
        ]}
      />

      {step === 1 && (
        <Step1
          detail={detail}
          errors={errors}
          isOnlyMap={isOnlyMap}
          lineOptions={lineOptions}
          processOptions={processOptions}
          productOptions={productOptions}
          processIdOptions={processIdOptions}
          FlowProductOptions={FlowProductOptions}
          FlowProcessIdOptions={FlowProcessIdOptions}
          FlowLayerIdOptions={FlowLayerIdOptions}
          BbProductOptions={BbProductOptions}
          BbProductidOptions={BbProductidOptions}
          refDocLabel={refDocLabel}
          setRefDocLabel={setRefDocLabel}
          refDocId={refDocId}
          setRefDocId={setRefDocId}
          approvedDocs={approvedDocs}
          productionDate={productionDate}
          setProductionDate={setProductionDate}
          handleDetailChange={handleDetailChange}
          handleDetailSet={handleDetailSet}
          handleRequestPurposeSelect={handleRequestPurposeSelect}
          handleRefDocSelect={handleRefDocSelect}
          handleMergeClick={handleMergeClick}
          handleFlowChange={handleFlowChange}
          handleFlowDeleteRow={handleFlowDeleteRow}
          handleFlowAddRow={handleFlowAddRow}
          handleBbEntryChange={handleBbEntryChange}
          handleBbEntryDelete={handleBbEntryDelete}
          handleBbEntryAdd={handleBbEntryAdd}
          GuideBadge={GuideBadge}
        />
      )}
      {step === 2 && (
        <StepMap
          detail={detail}
          errors={errors}
          lineOptions={lineOptions}
          processOptions={processOptions}
          sourcePartIdOptions={sourcePartIdOptions}
          topProductOptions={topProductOptions}
          middleProductOptions={middleProductOptions}
          bottomProductOptions={bottomProductOptions}
          prodcCopyRegion={prodcCopyRegion}
          revLayersSelected={revLayersSelected}
          setRevLayersSelected={setRevLayersSelected}
          revGds={revGds}
          setRevGds={setRevGds}
          availableRevLayers={availableRevLayers}
          isProdc={isProdc}
          isMapRegistered={isMapRegistered}
          hasMapChange={hasMapChange}
          hasEaChange={hasEaChange}
          mshotDeleteMode={mshotDeleteMode}
          mshotEditAddMode={mshotEditAddMode}
          setDetail={setDetail}
          handleReset={handleReset}
          handleMapTypeSelect={handleMapTypeSelect}
          handleDetailChange={handleDetailChange}
          handleDetailSet={handleDetailSet}
          handleProdcRegionSelect={handleProdcRegionSelect}
          handleProdcProcessChange={handleProdcProcessChange}
          handleImagePaste={handleImagePaste}
          GuideBadge={GuideBadge}
        />
      )}
      {step === 3 && (
        <Step2
          jayerRows={jayerRows}
          setJayerRows={setJayerRows}
          jayerSortBySp={jayerSortBySp}
          setJayerSortBySp={setJayerSortBySp}
          jayerFilterSets={jayerFilterSets}
          jayerActiveFilterIds={jayerActiveFilterIds}
          setJayerActiveFilterIds={setJayerActiveFilterIds}
          setJayerFilterModalOpen={setJayerFilterModalOpen}
          jayerDragInfo={jayerDragInfo}
          jayerChecked={jayerChecked}
          mappedJayerRowIds={mappedJayerRowIds}
          jayerBarcodeCache={jayerBarcodeCache}
          calcDisabled={calcDisabled}
          handleJayerSetAll={handleJayerSetAll}
          handleJayerResetField={handleJayerResetField}
          handleJayerCheckAll={handleJayerCheckAll}
          handleJayerDragEnter={handleJayerDragEnter}
          handleJayerDragStart={handleJayerDragStart}
          handleJayerCheckToggle={handleJayerCheckToggle}
          handleJayerChange={handleJayerChange}
          handleJayerAddRow={handleJayerAddRow}
          handleJayerBulkDisable={handleJayerBulkDisable}
          handleJayerBulkRestore={handleJayerBulkRestore}
          cellSel={jayerCellSel}
          GuideBadge={GuideBadge}
        />
      )}
      {step === 4 && (
        <Step3
          oayerRows={oayerRows}
          setOayerRows={setOayerRows}
          oayerSortBySp={oayerSortBySp}
          setOayerSortBySp={setOayerSortBySp}
          oayerFilterSets={oayerFilterSets}
          oayerActiveFilterIds={oayerActiveFilterIds}
          setOayerActiveFilterIds={setOayerActiveFilterIds}
          setOayerFilterModalOpen={setOayerFilterModalOpen}
          oayerDragInfo={oayerDragInfo}
          oayerChecked={oayerChecked}
          oayerInfoTab={oayerInfoTab}
          setOayerInfoTab={setOayerInfoTab}
          detail={detail}
          setDetail={setDetail}
          errors={errors}
          setErrors={setErrors}
          tbvtlvSdsSelected={tbvtlvSdsSelected}
          setTbvtlvSdsSelected={setTbvtlvSdsSelected}
          tbvtlvNote={tbvtlvNote}
          setTbvtlvNote={setTbvtlvNote}
          calcDisabled={calcDisabled}
          handleOayerSetAll={handleOayerSetAll}
          handleOayerResetField={handleOayerResetField}
          handleOayerCheckAll={handleOayerCheckAll}
          handleOayerDragEnter={handleOayerDragEnter}
          handleOayerDragStart={handleOayerDragStart}
          handleOayerCheckToggle={handleOayerCheckToggle}
          handleOayerChange={handleOayerChange}
          handleOayerAddRow={handleOayerAddRow}
          handleOayerBulkDisable={handleOayerBulkDisable}
          handleOayerBulkRestore={handleOayerBulkRestore}
          cellSel={oayerCellSel}
          GuideBadge={GuideBadge}
        />
      )}
      {step === 5 && (
        <Step4
          bbExternalData={bbExternalData}
          activeBbTab={activeBbTab}
          setActiveBbTab={setActiveBbTab}
          detail={detail}
          errors={errors}
          bbSearchQueries={bbSearchQueries}
          setBbSearchQueries={setBbSearchQueries}
          stagedMappings={stagedMappings}
          showAutoFillPanel={showAutoFillPanel}
          setShowAutoFillPanel={setShowAutoFillPanel}
          bbAutoFillRanges={bbAutoFillRanges}
          setBbAutoFillRanges={setBbAutoFillRanges}
          jayerRows={jayerRows}
          mappedJayerRowIds={mappedJayerRowIds}
          selectedJayerRowId={selectedJayerRowId}
          setSelectedJayerRowId={setSelectedJayerRowId}
          bbExternalLoading={bbExternalLoading}
          bbRows={bbRows}
          bbChecked={bbChecked}
          setDeleteConfirm={setDeleteConfirm}
          handleOpenAutoFillPanel={handleOpenAutoFillPanel}
          handleRangeChange={handleRangeChange}
          handleRemoveRange={handleRemoveRange}
          handleAddRange={handleAddRange}
          handleApplyAutoFill={handleApplyAutoFill}
          handleClearStaging={handleClearStaging}
          handleStageMapping={handleStageMapping}
          handleApplyMappings={handleApplyMappings}
          handleResetBbRows={handleResetBbRows}
          handleBbCheckAll={handleBbCheckAll}
          handleBbCheckToggle={handleBbCheckToggle}
          handleBbChange={handleBbChange}
          handleSortBbRows={handleSortBbRows}
          handleBbAddRow={handleBbAddRow}
          handleBbBulkDelete={handleBbBulkDelete}
          GuideBadge={GuideBadge}
        />
      )}

      <div className="form-actions" style={step > 1 ? { justifyContent: 'space-between' } : {}}>
        {step > 1 && (
          <button className="btn btn-secondary" onClick={handlePrevStep}>
            ← 이전
          </button>
        )}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={saving}>
            💾 {saving ? t('common.loading') : t('request.save_draft')}
          </button>
          {step < 5 ? (
            <button className="btn btn-primary" onClick={() => handleNextStep()}>
              다음 →
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleSubmitClick} disabled={submitting}>
              📤 {submitting ? t('common.loading') : t('request.submit')}
            </button>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm?.onConfirm()}
        title={t('common.confirm')}
        message={deleteConfirm?.message ?? ''}
        confirmLabel={t('common.restore')}
        danger
      />

      {/* J-ayer 필터 관리 모달 */}
      <FilterManageModal
        isOpen={jayerFilterModalOpen}
        onClose={() => { setJayerFilterModalOpen(false); setJayerNewFilter({ label: '', words: emptyDraftWords() }); }}
        title={t('request.jayer_filter_manage')}
        storageKey="jayerFilterSets"
        filterSets={jayerFilterSets}
        setFilterSets={setJayerFilterSets}
        newFilter={jayerNewFilter}
        setNewFilter={setJayerNewFilter}
        onAllDelete={() => setFilterAllDeleteConfirm('jayer')}
        onRequestDelete={(fs) => setFilterDeleteConfirm({ type: 'jayer', filterId: fs.id, label: fs.label })}
        onEdit={(filterId, label, words) => {
          const updated = jayerFilterSets.map(f => f.id === filterId ? { ...f, label, words } : f);
          setJayerFilterSets(updated);
          localStorage.setItem('jayerFilterSets', JSON.stringify(updated));
          setJayerRows(rows => rows.map(r => ({ ...r, disabled: calcDisabled(r, updated, jayerActiveFilterIds) })));
        }}
      />

      {/* O-ayer 필터 관리 모달 */}
      <FilterManageModal
        isOpen={oayerFilterModalOpen}
        onClose={() => { setOayerFilterModalOpen(false); setOayerNewFilter({ label: '', words: emptyDraftWords() }); }}
        title={t('request.oayer_filter_manage')}
        storageKey="oayerFilterSets"
        filterSets={oayerFilterSets}
        setFilterSets={setOayerFilterSets}
        newFilter={oayerNewFilter}
        setNewFilter={setOayerNewFilter}
        onAllDelete={() => setFilterAllDeleteConfirm('oayer')}
        onRequestDelete={(fs) => setFilterDeleteConfirm({ type: 'oayer', filterId: fs.id, label: fs.label })}
        onEdit={(filterId, label, words) => {
          const updated = oayerFilterSets.map(f => f.id === filterId ? { ...f, label, words } : f);
          setOayerFilterSets(updated);
          localStorage.setItem('oayerFilterSets', JSON.stringify(updated));
          setOayerRows(rows => rows.map(r => ({ ...r, disabled: calcDisabled(r, updated, oayerActiveFilterIds) })));
        }}
      />

      <Modal
        isOpen={mergeConfirmOpen}
        onClose={() => setMergeConfirmOpen(false)}
        title="Merge 확인"
        size="md"
        style={{ maxWidth: '420px' }}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setMergeConfirmOpen(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" onClick={handleMergeConfirm}>
              {t('common.confirm')}
            </button>
          </>
        }
      >
        <div style={{ color: 'var(--text-secondary)', lineHeight: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '4px' }}>
            <span>{t('request.jayer')}</span>
            <span>기등록 <b>{mergeStats?.jayerMatched ?? 0}</b>건 / 미매칭 <b>{mergeStats?.jayerUnmatchedRef ?? 0}</b>건 추가 예정</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '12px' }}>
            <span>{t('request.oayer')}</span>
            <span>기등록 <b>{mergeStats?.oayerMatched ?? 0}</b>건 / 미매칭 <b>{mergeStats?.oayerUnmatchedRef ?? 0}</b>건 추가 예정</span>
          </div>
          <p style={{ margin: 0 }}>진행하시겠습니까?</p>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={tbvtlvWarnModal}
        onClose={() => setTbvtlvWarnModal(false)}
        onConfirm={() => handleNextStep(true)}
        title={t('request.tbvtlv_warn_title')}
        message={t('request.tbvtlv_warn_body')}
        confirmLabel={t('request.tbvtlv_warn_proceed')}
      />

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={isPeerReviewMode ? t('approval.peer_submit') : t('request.submit')}
        size="md"
        style={{ maxWidth: '520px' }}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting || (!isPeerReviewMode && !designeeLoginid)}
            >
              📤 {submitting ? t('common.loading') : (isPeerReviewMode ? t('approval.peer_submit') : t('request.submit'))}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">{t('request.submit_note_label')}</label>
          <textarea
            className="form-control"
            rows={3}
            placeholder={t('request.submit_note_placeholder')}
            value={submitNote}
            onChange={(e) => setSubmitNote(e.target.value)}
          />
        </div>
        {!isPeerReviewMode && (
          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label">
              {t('request.designee_label')} <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            {designeeLoginid ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-secondary)', padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <span style={{ flex: 1, fontSize: '0.875rem' }}>✓ {designeeName}</span>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                  onClick={() => { setDesigneeLoginid(''); setDesigneeName(''); setDesigneeSearchQuery(''); }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <>
                <div style={{ position: 'relative' }}>
                  <input
                    ref={designeeInputRef}
                    className="form-control"
                    placeholder={t('request.designee_placeholder')}
                    value={designeeSearchQuery}
                    onChange={(e) => {
                      setDesigneeSearchQuery(e.target.value);
                      setDesigneeError('');
                      if (designeeInputRef.current) {
                        const r = designeeInputRef.current.getBoundingClientRect();
                        setDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                      }
                    }}
                    autoComplete="off"
                  />
                  {designeeSearchQuery && dropdownRect && createPortal(
                    <div style={{ position: 'fixed', top: dropdownRect.top, left: dropdownRect.left, width: dropdownRect.width, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', zIndex: 9999, maxHeight: 180, overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
                      {plUserOptions
                        .filter(u =>
                          u.name.toLowerCase().includes(designeeSearchQuery.toLowerCase()) ||
                          u.loginid.toLowerCase().includes(designeeSearchQuery.toLowerCase())
                        )
                        .map(u => (
                          <div
                            key={u.loginid}
                            style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.875rem' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                            onClick={() => {
                              setDesigneeLoginid(u.loginid);
                              setDesigneeName(`${u.name} (${u.deptname})`);
                              setDesigneeSearchQuery('');
                              setDropdownRect(null);
                              setDesigneeError('');
                            }}
                          >
                            <span style={{ fontWeight: 600 }}>{u.name}</span>
                            <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: '0.8rem' }}>{u.deptname}</span>
                          </div>
                        ))}
                      {plUserOptions.filter(u =>
                        u.name.toLowerCase().includes(designeeSearchQuery.toLowerCase()) ||
                        u.loginid.toLowerCase().includes(designeeSearchQuery.toLowerCase())
                      ).length === 0 && (
                        <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>검색 결과 없음</div>
                      )}
                    </div>,
                    document.body
                  )}
                </div>
                {designeeError && (
                  <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: 4 }}>{designeeError}</p>
                )}
              </>
            )}
          </div>
        )}
      </Modal>

      <ConfirmModal
        isOpen={!!mapTypeChangeConfirm}
        onClose={() => setMapTypeChangeConfirm(null)}
        onConfirm={handleMapTypeChangeConfirm}
        title={t('request.map_type_change_confirm_title')}
        message={t('request.map_type_change_confirm_msg')}
        danger
      />

      <ConfirmModal
        isOpen={onlyMapConfirm}
        onClose={() => setOnlyMapConfirm(false)}
        onConfirm={handleOnlyMapConfirm}
        title={t('request.only_map_confirm_title')}
        message={t('request.only_map_confirm_msg')}
        danger
      />

      <ConfirmModal
        isOpen={!!bbConflictState}
        onClose={() => {
          const rowsToAdd = bbConflictState?.rowsToAdd ?? [];
          setBbConflictState(null);
          if (rowsToAdd.length > 0) {
            bbPartialAddRowsRef.current = rowsToAdd;
            setBbPartialAddConfirm(true);
          }
        }}
        onConfirm={() => {
          if (!bbConflictState) return;
          const { rowsToReplace, existingRowIdsToRemove, rowsToAdd } = bbConflictState;
          setBbConflictState(null);
          applyBbRowChanges(rowsToReplace, existingRowIdsToRemove, rowsToAdd);
        }}
        title={t('common.confirm')}
        message={t('request.bb_overwrite_confirm_with_layers', {
          layers: bbConflictState?.duplicateLayerIds.join(', ') ?? '',
        })}
        danger
      />

      <ConfirmModal
        isOpen={bbPartialAddConfirm}
        onClose={() => {
          bbPartialAddRowsRef.current = [];
          setBbPartialAddConfirm(false);
        }}
        onConfirm={() => {
          const rowsToAdd = bbPartialAddRowsRef.current;
          bbPartialAddRowsRef.current = [];
          setBbPartialAddConfirm(false);
          applyBbRowChanges([], [], rowsToAdd);
        }}
        title={t('common.confirm')}
        message={t('request.bb_partial_add_confirm', {
          count: bbPartialAddRowsRef.current.length,
        })}
      />

      <ConfirmModal
        isOpen={bbResetConfirm}
        onClose={() => setBbResetConfirm(false)}
        onConfirm={proceedResetBbRows}
        title={t('common.confirm')}
        message={t('request.bb_reset_confirm')}
        danger
      />

      <ConfirmModal
        isOpen={specialCareConfirm}
        onClose={() => setSpecialCareConfirm(false)}
        onConfirm={() => handleNextStep(false, true)}
        title={t('request.tbvtlv_warn_title')}
        message={t('request.special_care_confirm')}
        confirmLabel={t('request.tbvtlv_warn_proceed')}
      />

      <ConfirmModal
        isOpen={!!filterDeleteConfirm}
        onClose={() => setFilterDeleteConfirm(null)}
        onConfirm={handleFilterDeleteConfirm}
        title={t('common.confirm')}
        message={t('request.filter_delete_confirm', { label: filterDeleteConfirm?.label ?? '' })}
        confirmLabel={t('common.delete')}
        danger
        topLevel
      />

      <ConfirmModal
        isOpen={!!filterAllDeleteConfirm}
        onClose={() => setFilterAllDeleteConfirm(null)}
        onConfirm={handleFilterAllDeleteConfirm}
        title={t('common.confirm')}
        message={t('request.filter_all_delete_confirm')}
        confirmLabel={t('common.delete')}
        danger
        topLevel
      />

      <GuideSlidePanel
        featureKey={slidePanel.featureKey}
        featureTitle={slidePanel.title}
        isOpen={slidePanel.open}
        onClose={() => setSlidePanel((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}
