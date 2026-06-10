import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { documentsAPI, linesAPI, formOptionsAPI, uploadImageAPI, guidesAPI } from '../../api/client';
import { useToast } from '../../components/Toast';
import { useIdleTimer } from '../../hooks/useIdleTimer';
import Modal, { ConfirmModal } from '../../components/Modal';
import FormSelect from '../../components/FormSelect';
import AutocompleteInput from '../../components/AutocompleteInput';
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
} from '../../types';
import GuideSlidePanel from '../../components/GuideSlidePanel';
import {
  OPTION_REQUEST_PURPOSE,
  OPTION_LINE,
  OPTION_OTHER_PURPOSE,
  ST_CELL_COLOR,
  CRegion,
  genId,
  makeRow,
  makeJayerRow,
  makeOayerRow,
  makeBbRow,
  INITIAL_DETAIL,
  INITIAL_FORM,
  DETAIL_REQUIRED,
} from './constants';
import ProdcRow from './components/ProdcRow';

// ===== Mshot Image Upload =====
interface MshotImageUploadProps {
  fieldName: 'mshot_image_copy' | 'mshot_image_copy_top' | 'mshot_image_copy_bottom';
  value: string;
  error?: string;
  disabled: boolean;
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>, fieldName: 'mshot_image_copy' | 'mshot_image_copy_top' | 'mshot_image_copy_bottom') => void;
}

const MshotImageUpload: React.FC<MshotImageUploadProps> = ({ fieldName, value, error, disabled, onPaste }) => (
  <div>
    <div
      className="image-upload-area"
      style={{
        border: `2px dashed ${error ? '#dc3545' : '#ccc'}`,
        borderRadius: '8px',
        padding: '20px',
        textAlign: 'center',
        minHeight: '100px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: error ? '#fff5f5' : '#f9f9f9',
      }}
      onPaste={disabled ? undefined : (e) => onPaste(e, fieldName)}
    >
      {value ? (
        <div style={{ width: '100%' }}>
          <img
            src={`/media/${value}`}
            alt="attached"
            style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '4px', border: '1px solid #ddd' }}
          />
          <p style={{ margin: '8px 0 0 0', color: '#666', fontSize: '13px' }}>
            이미지가 첨부되었습니다. Ctrl+V 로 다시 붙여넣으면 변경됩니다.
          </p>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>📋</div>
          <p style={{ margin: '0', color: '#666' }}>Ctrl+V 로 이미지를 붙여넣으세요</p>
        </div>
      )}
    </div>
    {error && <span className="form-error">{error}</span>}
  </div>
);

// ===== Wizard Step Indicator =====
interface WizardIndicatorProps {
  currentStep: number;
  steps: string[];
}

const WizardIndicator: React.FC<WizardIndicatorProps> = ({ currentStep, steps }) => (
  <div className="wizard-indicator">
    {steps.map((label, idx) => {
      const stepNum = idx + 1;
      const isDone = currentStep > stepNum;
      const isActive = currentStep === stepNum;
      return (
        <React.Fragment key={stepNum}>
          <div className="wizard-step">
            <div className={`wizard-step-circle${isDone ? ' done' : isActive ? ' active' : ''}`}>
              {isDone ? '✓' : stepNum}
            </div>
            <span className={`wizard-step-label${isDone ? ' done' : isActive ? ' active' : ''}`}>
              {label}
            </span>
          </div>
          {idx < steps.length - 1 && (
            <div className={`wizard-connector${isDone ? ' done' : ''}`} />
          )}
        </React.Fragment>
      );
    })}
  </div>
);

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
  const [jayerBarcodeCache, setJayerBarcodeCache] = useState<Record<string, { label: string; n7c_layer_num: string }[]>>({});
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
  const [isBbSorted, setIsBbSorted] = useState(false);  // STEPSEQ 정렬 상태
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
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitNote, setSubmitNote] = useState('');
  const [savedId, setSavedId] = useState<number | null>(editDocId);
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
  const emptyDraftWords = () => ({ sp: [] as string[], sd: [] as string[], pp: [] as string[] });
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
        setFeatureGuideKeys(new Set(items.map((g: { feature_key: string | null }) => g.feature_key).filter(Boolean) as string[]));
      })
      .catch(() => { /* 가이드 없어도 무관 */ });
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

  // 편집 모드: 기존 문서 데이터 로드
  useEffect(() => {
    if (!editDocId) return;
    isLoadingEditRef.current = true;
    documentsAPI.get(editDocId).then((res) => {
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
  }, [editDocId]);

  // Derived booleans for Step 1 conditional rendering
  const isMapRegistered = detail.map_type === 'EXISTING' || detail.map_type === 'CLONE';
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
    handleDetailSet('request_purpose', val);
  };

  const handleMapTypeSelect = (val: string) => {
    if (val === detail.map_type) return;
    if (val === 'CLONE' || val === 'EXISTING') {
      setMapTypeChangeConfirm({ targetType: val });
      return;
    }
    setDetail((prev) => ({ ...prev, map_type: val }));
    if (errors['map_type']) setErrors((prev) => ({ ...prev, map_type: '' }));
  };

  const handleMapTypeChangeConfirm = () => {
    if (!mapTypeChangeConfirm) return;
    const newType = mapTypeChangeConfirm.targetType;
    setDetail({ ...INITIAL_DETAIL, map_type: newType });
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
  const formatUpdatedDate = (updated: string): string => {
    if (!updated || updated.length < 12) return updated;
    const yyyyMMdd = updated.slice(0, 8);
    const hh = updated.slice(8, 10);
    const mm = updated.slice(10, 12);
    return `${yyyyMMdd} ${hh}:${mm}`;
  };

  const handleFlowDeleteRow = (id: string) => {
    setDetail((prev) => {
      if (prev.flow_chart.length <= 1) return prev;
      return { ...prev, flow_chart: prev.flow_chart.filter((r) => r.id !== id) };
    });
  };

  // ===== Jayer & Oayer Handlers =====
  // ===== 비활성화 필터 확인 함수 (키워드 배열 지원) =====
  const shouldDisableRow = (filterWords: { sp: string[]; sd: string[]; pp: string[] }, row: { sp: string; sd: string; pp: string }): boolean => {
    const { sp, sd, pp } = filterWords;
    if (sp.some(keyword => keyword && row.sp.toLowerCase().includes(keyword.toLowerCase()))) return true;
    if (sd.some(keyword => keyword && row.sd.toLowerCase().includes(keyword.toLowerCase()))) return true;
    if (pp.some(keyword => keyword && row.pp.toLowerCase().includes(keyword.toLowerCase()))) return true;
    return false;
  };

  const calcDisabled = (
    row: { manuallyDisabled: boolean; sp: string; sd: string; pp: string },
    filterSets: FilterSet[],
    activeIds: Set<string>
  ): boolean =>
    row.manuallyDisabled || filterSets.some(fs => activeIds.has(fs.id) && shouldDisableRow(fs.words, row));

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
      if (field === 'product_name') return { ...r, product_name: value, item_id: '' };
      return { ...r, [field]: value };
    }));
    if (field === 'product_name') {
      if (value) {
        formOptionsAPI.getBarcodeOptions(value).then((options) => {
          setJayerBarcodeCache((prev) => ({ ...prev, [id]: options }));
        });
      } else {
        setJayerBarcodeCache((prev) => ({ ...prev, [id]: [] }));
      }
    }
  };

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
    const mode = jayerChecked.has(id) ? 'uncheck' : 'check';
    jayerDragInfo.current = { startId: id, mode };
    setJayerChecked((prev) => {
      const next = new Set(prev);
      mode === 'check' ? next.add(id) : next.delete(id);
      return next;
    });
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
    setOayerRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
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
    const mode = oayerChecked.has(id) ? 'uncheck' : 'check';
    oayerDragInfo.current = { startId: id, mode };
    setOayerChecked((prev) => {
      const next = new Set(prev);
      mode === 'check' ? next.add(id) : next.delete(id);
      return next;
    });
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
        newRow.bb_step = '';
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
    setIsBbSorted(false);
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
    setIsBbSorted(false);
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
      setIsBbSorted(true);
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
      const filledBb = detail.bb_entries.filter(
        (e) => e.location?.trim() && e.product?.trim() && e.process_id?.trim()
      );
      if (filledBb.length === 0) {
        newErrors['bb_entries'] = t('request.required');
        errorMessages.push('Backbone 조합 영역: 최소 1개 이상 입력해야 합니다.');
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

    if (currentStep === 3) {
      // TODO: J-ayer 행 검증 로직 추가
    }

    if (currentStep === 4) {
      if (!detail.partial_shot?.trim()) {
        newErrors['partial_shot'] = t('request.required');
        errorMessages.push('Partial Shot 계측 필요: 필수 선택 항목입니다.');
      }
    }

    if (currentStep === 4) {
      // TODO: O-ayer 행 검증 로직 추가
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
    }
  };

  const handleIdleAutoSave = async () => {
    if (!detail.line || !detail.partid_selection || !detail.process_selection || !detail.process_id) return;
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
    }
  };

  useIdleTimer(handleIdleAutoSave, 20 * 60 * 1000);

  const handleNextStep = (skipTbvtlvWarn = false, skipSpecialCare = false) => {
    if (step === 1 || step === 2 || step === 4) {
      const result = validate(step);
      if (!result.valid) {
        result.errors.forEach(msg => addToast(msg, 'error'));
        window.scrollTo({ top: 0, behavior: 'smooth' });
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

  const handleSubmitClick = () => {
    const result = validate(5);
    if (!result.valid) {
      result.errors.forEach(msg => addToast(msg, 'error'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setConfirmOpen(true);
  };

  const handleSubmit = async () => {
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

      const doc = await documentsAPI.get(docId!);
      const isRejected = doc.data.status === 'rejected';

      if (isRejected) {
        const enrichedWithHistory = buildEnrichedForm(submitNote, true);
        await documentsAPI.update(docId!, enrichedWithHistory);
        await documentsAPI.resubmit(docId!);
        addToast('재상신되었습니다.', 'success');
      } else {
        const submitRes = await documentsAPI.submit(docId!);
        addToast(t('request.submit_success'), 'success');
        if (submitRes.data.email_sent) {
          setTimeout(() => addToast(t('request.messenger_sent_to_manager'), 'info'), 800);
        }
      }
      setTimeout(() => navigate('/approval'), 1500);
    } catch (err) {
      console.error('상신 오류:', err);
      addToast(`오류 발생: ${err instanceof Error ? err.message : '알 수 없는 오류'}`, 'error');
    } finally {
      setSubmitting(false);
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

  const GuideBadge = ({ fk, tk }: { fk: GuideFeatureKey; tk: string }) =>
    featureGuideKeys.has(fk) ? (
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); toggleSlidePanel(fk, tk); }}
        style={{
          fontSize: 10,
          padding: '2px 7px',
          border: '1px solid #4f8ef7',
          borderRadius: 10,
          background: slidePanel.open && slidePanel.featureKey === fk ? '#eff6ff' : 'transparent',
          color: '#4f8ef7',
          cursor: 'pointer',
          marginLeft: 6,
          verticalAlign: 'middle',
          fontWeight: 600,
          lineHeight: 1.4,
        }}
      >
        {t('guide.guide_btn')}
      </button>
    ) : null;

  // ===== Step Render Functions =====
  const renderStep1 = () => {
    const canSelectPurpose =
      detail.line !== '' &&
      detail.process_selection !== '' &&
      detail.partid_selection !== '' &&
      detail.process_id !== '';

    return (
    <div className="form-section">
      <div className="form-section-title">📋 {t('request.section_detail')}</div>
      <div className="form-grid">

        {/* 1. 라인 / 조합법 / 제품 이름 / 조리법 */}
        <div className="full-width" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('request.line')} / {t('request.process_selection')}</span>
          <GuideBadge fk="step1_line_process" tk={t('guide.feat.step1_line_process' as never)} />
        </div>
        <div className="full-width flex-row">
          <FormSelect
            label={t('request.line')}
            name="line"
            value={detail.line}
            options={lineOptions}
            onChange={handleDetailChange}
            placeholder={t('request.select_placeholder')}
            required
            error={errors.line}
            className="flex-col"
          />
          <AutocompleteInput
            label={t('request.process_selection')}
            value={detail.process_selection}
            options={processOptions}
            onChange={(v) => handleDetailSet('process_selection', v)}
            required
            error={errors.process_selection}
            style={{ flex: 1 }}
          />
          <AutocompleteInput
            label={t('request.partid_selection')}
            value={detail.partid_selection}
            options={productOptions}
            onChange={(v) => handleDetailSet('partid_selection', v)}
            required
            error={errors.partid_selection}
            style={{ flex: 1 }}
          />
          <AutocompleteInput
            label={t('request.process_id')}
            value={detail.process_id}
            options={processIdOptions}
            onChange={(v) => handleDetailSet('process_id', v)}
            placeholder={t('request.select_placeholder')}
            required
            error={errors.process_id}
            style={{ flex: 1 }}
          />
        </div>

        {/* 안내 문구 */}
        {!canSelectPurpose && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            라인, 조합법, 제품 이름, 조리법을 모두 선택하면 나머지 항목을 입력할 수 있습니다.
          </span>
        )}

        {/* 2. 요청 목적 */}
        <div className="form-group full-width">
          <label className="form-label">
            {t('request.request_purpose')} <span className="required">*</span>
            <GuideBadge fk="step1_request_purpose" tk={t('guide.feat.step1_request_purpose' as never)} />
          </label>
          <div style={{ display: 'flex', gap: '8px', marginTop: 4 }}>
            {OPTION_REQUEST_PURPOSE.map((val) => (
              <button
                key={val}
                type="button"
                className={`map-type-btn${detail.request_purpose === val ? ' active' : ''}`}
                onClick={() => { if (canSelectPurpose) handleRequestPurposeSelect(val); }}
                disabled={!canSelectPurpose}
              >
                {val}
              </button>
            ))}
          </div>
          {errors.request_purpose && <span className="form-error">{errors.request_purpose}</span>}
        </div>

        {/* 기타 목적 / 흐름도 / 특이사항 */}
        <div className="form-group full-width">
          <div className="conditional-group">
            <div className="flex-col">
              <label className="form-label">{t('request.other_purpose')}<GuideBadge fk="step1_other_purpose" tk={t('guide.feat.step1_other_purpose' as never)} /></label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: 4 }}>
                {OPTION_OTHER_PURPOSE.map((val) => (
                  <button
                    key={val}
                    type="button"
                    className={`map-type-btn${detail.other_purpose === val ? ' active' : ''}`}
                    onClick={() => { if (canSelectPurpose) handleDetailSet('other_purpose', detail.other_purpose === val ? '' : val); }}
                    disabled={!canSelectPurpose}
                  >
                    {val}
                  </button>
                ))}
              </div>
            </div>

            {/* Layer 추가/삭제: 참조 요청서 선택 */}
            {detail.other_purpose === 'Layer 추가/삭제' && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <AutocompleteInput
                    label="참조 요청서"
                    value={refDocLabel}
                    options={approvedDocs.map((d) => d.title)}
                    onChange={(v) => {
                      setRefDocLabel(v);
                      if (refDocId !== null) setRefDocId(null);
                    }}
                    onSelect={handleRefDocSelect}
                    placeholder="이력에서 요청서를 선택하세요"
                    disabled={!canSelectPurpose}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canSelectPurpose || refDocId === null}
                  style={!canSelectPurpose || refDocId === null ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                  onClick={handleMergeClick}
                >
                  Merge
                </button>
              </div>
            )}

            {/* 흐름도 */}
            <div className="form-group">
              <label className="form-label">{t('request.flow_chart')}<GuideBadge fk="step1_flow_chart" tk={t('guide.feat.step1_flow_chart' as never)} /></label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {detail.flow_chart.map((row, idx) => (
                  <div key={row.id} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                      <label className="form-label">{t('request.flow_line')}</label>
                      <select
                        className="form-control"
                        value={row.location}
                        onChange={(e) => handleFlowChange(row.id, 'location', e.target.value)}
                        disabled={!canSelectPurpose}
                      >
                        <option value="">{t('request.select_placeholder')}</option>
                        {lineOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                      <label className="form-label">{t('request.flow_partid')}</label>
                      <AutocompleteInput
                        value={row.product_name}
                        onChange={(v) => handleFlowChange(row.id, 'product_name', v)}
                        options={FlowProductOptions[idx] || []}
                        placeholder={t('request.select_placeholder')}
                        style={{ width: '100%' }}
                        disabled={!canSelectPurpose}
                      />
                    </div>
                    <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                      <label className="form-label">{t('request.flow_process_id')}</label>
                      <AutocompleteInput
                        value={row.process_id}
                        onChange={(v) => handleFlowChange(row.id, 'process_id', v)}
                        options={FlowProcessIdOptions[idx] || []}
                        placeholder={t('request.select_placeholder')}
                        style={{ width: '100%' }}
                        disabled={!canSelectPurpose}
                      />
                    </div>
                    <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                      <label className="form-label">{t('request.flow_progress_layer')}</label>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <AutocompleteInput
                          value={row.step_from}
                          onChange={(v) => handleFlowChange(row.id, 'step_from', v)}
                          options={FlowLayerIdOptions[idx] || []}
                          placeholder={t('request.select_placeholder')}
                          style={{ minWidth: '80px' }}
                          disabled={!canSelectPurpose}
                        />
                        <span style={{ whiteSpace: 'nowrap' }}>~</span>
                        <AutocompleteInput
                          value={row.step_to}
                          onChange={(v) => handleFlowChange(row.id, 'step_to', v)}
                          options={FlowLayerIdOptions[idx] || []}
                          placeholder={t('request.select_placeholder')}
                          style={{ minWidth: '80px' }}
                          disabled={!canSelectPurpose}
                        />
                      </div>
                    </div>
                    {detail.flow_chart.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ padding: '6px 10px', marginBottom: '2px' }}
                        onClick={() => handleFlowDeleteRow(row.id)}
                        disabled={!canSelectPurpose}
                      >
                        {t('request.bb_delete')}
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" className="btn btn-secondary" onClick={handleFlowAddRow} disabled={!canSelectPurpose}>
                  + {t('request.flow_add_row')}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">{t('request.change_purpose_note')}</label>
              <textarea
                className="form-control"
                name="change_purpose_note"
                value={detail.change_purpose_note}
                onChange={handleDetailChange}
                rows={3}
                disabled={!canSelectPurpose}
              />
            </div>
          </div>
        </div>

        {/* 3. 뼈찜 조합 영역 */}
        <div className="full-width" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label className="form-label">
            {t('request.bb_status')} <span className="required">*</span>
            <GuideBadge fk="step1_bb_entry" tk={t('guide.feat.step1_bb_entry' as never)} />
          </label>
          {errors.bb_entries && <span className="form-error">{errors.bb_entries}</span>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {detail.bb_entries.map((entry, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                  <label className="form-label">{t('request.bb_ref_line')}</label>
                  <select
                    className="form-control"
                    value={entry.location}
                    onChange={(e) => handleBbEntryChange(idx, 'location', e.target.value)}
                    disabled={!canSelectPurpose}
                  >
                    <option value="">{t('request.select_placeholder')}</option>
                    {lineOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                  <label className="form-label">{t('request.bb_ref_part_id')}</label>
                  <AutocompleteInput
                    value={entry.product}
                    onChange={(v) => handleBbEntryChange(idx, 'product', v)}
                    options={BbProductOptions[idx] || []}
                    placeholder={t('request.select_placeholder')}
                    style={{ width: '100%' }}
                    disabled={!canSelectPurpose}
                  />
                </div>
                <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                  <label className="form-label">{t('request.bb_ref_process_id')}</label>
                  <AutocompleteInput
                    value={entry.process_id}
                    onChange={(v) => handleBbEntryChange(idx, 'process_id', v)}
                    options={BbProductidOptions[idx] || []}
                    placeholder={t('request.select_placeholder')}
                    style={{ width: '100%' }}
                    disabled={!canSelectPurpose}
                  />
                </div>
                {detail.bb_entries.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ padding: '6px 10px', marginBottom: '2px' }}
                    onClick={() => handleBbEntryDelete(idx)}
                    disabled={!canSelectPurpose}
                  >
                    {t('request.bb_delete')}
                  </button>
                )}
              </div>
            ))}
            <div>
              <button type="button" className="btn btn-secondary" onClick={handleBbEntryAdd} disabled={!canSelectPurpose}>
                + {t('request.bb_add')}
              </button>
            </div>
          </div>
        </div>

        {/* 4. 고객/업체명 / 요구 사항 */}
        <div className="full-width flex-row">
          <div className="form-group flex-col" style={{ flex: 1 }}>
            <label className="form-label">{t('request.customer_name')}<GuideBadge fk="step1_customer_vendor" tk={t('guide.feat.step1_customer_vendor' as never)} /></label>
            <input
              className="form-control"
              name="customer_name"
              value={detail.customer_name}
              onChange={handleDetailChange}
              disabled={!canSelectPurpose}
            />
          </div>
          <div className="form-group flex-col" style={{ flex: 2 }}>
            <label className="form-label">{t('request.customer_requirement')}</label>
            <input
              className="form-control"
              name="customer_requirement"
              value={detail.customer_requirement}
              onChange={handleDetailChange}
              disabled={!canSelectPurpose}
            />
          </div>
        </div>

        {/* 5. 실제 생산 진행 날짜 */}
        <div className="form-group full-width">
          <label className="form-label">{t('request.production_date')}</label>
          <input
            type="date"
            className="form-control"
            value={productionDate}
            onChange={(e) => setProductionDate(e.target.value)}
            disabled={!canSelectPurpose}
            style={{ maxWidth: '200px' }}
          />
        </div>

      </div>
    </div>
    );
  };

  const SELECT_W = '300px';

  const renderStepMap = () => (
    <div className="form-section">
      <div className="form-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>🗺️ {t('request.section_map')}</span>
        <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '4px 10px' }} onClick={handleReset}>
          🔄 {t('common.reset')}
        </button>
      </div>
      <div className="form-grid">

        {/* 요청 목적 (신규/차용/기등록) */}
        <div className="full-width">
          <label className="form-label">
            {t('request.map_type')} <span className="required">*</span>
            <GuideBadge fk="step2_map_type" tk={t('guide.feat.step2_map_type' as never)} />
          </label>
          <div style={{ display: 'flex', gap: '8px', marginTop: 4 }}>
            {(['NEW', 'CLONE', 'EXISTING'] as const).map((val) => {
              const labelKey = val === 'NEW' ? 'map_type_new' : val === 'CLONE' ? 'map_type_borrow' : 'map_type_registered';
              return (
                <button
                  key={val}
                  type="button"
                  className={`map-type-btn${detail.map_type === val ? ' active' : ''}`}
                  onClick={() => handleMapTypeSelect(val)}
                >
                  {t(`request.${labelKey}`)}
                </button>
              );
            })}
          </div>
          {errors.map_type && <span className="form-error">{errors.map_type}</span>}
        </div>

        {/* 원본 위치/Part ID */}
        <div className="full-width">
          <div className="conditional-group">
            <div className="flex-row">
              <div className="form-group flex-col">
                <label className="form-label">
                  {t('request.source_line')}
                  <GuideBadge fk="step2_source_location" tk={t('guide.feat.step2_source_location' as never)} />
                </label>
                <select
                  className="form-control"
                  name="source_line"
                  value={detail.source_line}
                  onChange={handleDetailChange}
                >
                  <option value="">{t('request.select_placeholder')}</option>
                  {lineOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <AutocompleteInput
                label={t('request.source_partid_selection')}
                value={detail.source_partid}
                options={sourcePartIdOptions}
                onChange={(v) => handleDetailSet('source_partid', v)}
                style={{ flex: 1 }}
              />
            </div>
          </div>
        </div>

        {/* Only C가문 제품 */}
        <div className="full-width" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="form-group" style={{ width: SELECT_W, flexShrink: 0, marginBottom: 0 }}>
            <label className="form-label">{t('request.prodc_status')}<GuideBadge fk="step2_cfamily" tk={t('guide.feat.step2_cfamily' as never)} /></label>
            <select
              className="form-control"
              name="only_prodc"
              value={detail.only_prodc}
              onChange={(e) => {
                handleDetailChange(e);
                if (e.target.value === 'No') {
                  setDetail((prev) => ({ ...prev, rev_yn: '', rev_entries: [] }));
                  setRevLayersSelected([]);
                  setRevGds('');
                }
              }}
              disabled={isMapRegistered}
            >
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          </div>
          {isProdc && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span className="form-label" style={{ marginBottom: 0 }}>{t('request.prodc_apply_region')}</span>
                {(['top', 'middle', 'bottom'] as CRegion[]).map((region) => (
                  <label key={region} className="radio-item" style={{ cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="prodc_copy_region"
                      checked={prodcCopyRegion === region}
                      onChange={() => handleProdcRegionSelect(region)}
                    />
                    <span className="radio-custom" />
                    {t(`request.prodc_${region}`)}
                  </label>
                ))}
              </div>
              <ProdcRow region="top"    detail={detail} onChange={handleDetailChange} onSetValue={handleDetailSet} lineOptions={lineOptions} processOptions={processOptions} productOptions={topProductOptions}    onProcessChange={handleProdcProcessChange} errors={errors} />
              <ProdcRow region="middle" detail={detail} onChange={handleDetailChange} onSetValue={handleDetailSet} lineOptions={lineOptions} processOptions={processOptions} productOptions={middleProductOptions}  onProcessChange={handleProdcProcessChange} errors={errors} />
              <ProdcRow region="bottom" detail={detail} onChange={handleDetailChange} onSetValue={handleDetailSet} lineOptions={lineOptions} processOptions={processOptions} productOptions={bottomProductOptions}  onProcessChange={handleProdcProcessChange} errors={errors} />

              {/* REV 여부 */}
              <div style={{ borderTop: '1px solid #e0e0e0', paddingTop: '14px', marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>REV 여부<GuideBadge fk="step2_rev" tk={t('guide.feat.step2_rev' as never)} /></label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['YES', 'NO'] as const).map((val) => (
                    <button
                      key={val}
                      type="button"
                      className={`map-type-btn${detail.rev_yn === val ? ' active' : ''}`}
                      onClick={() => {
                        if (val === 'NO') {
                          setDetail((prev) => ({ ...prev, rev_yn: val, rev_entries: [] }));
                          setRevLayersSelected([]);
                          setRevGds('');
                        } else {
                          setDetail((prev) => ({ ...prev, rev_yn: val }));
                        }
                      }}
                      disabled={isMapRegistered}
                    >
                      {val}
                    </button>
                  ))}
                </div>

                {detail.rev_yn === 'YES' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* 입력 행: Layer 버튼 + GDS version + 추가 버튼 */}
                    <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label className="form-label" style={{ marginBottom: 0 }}>Layer</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxWidth: '480px' }}>
                          {availableRevLayers.length > 0 ? availableRevLayers.map((layer) => {
                            const isSelected = revLayersSelected.includes(layer);
                            return (
                              <button
                                key={layer}
                                type="button"
                                onClick={() =>
                                  setRevLayersSelected((prev) =>
                                    isSelected ? prev.filter((l) => l !== layer) : [...prev, layer]
                                  )
                                }
                                style={{
                                  padding: '5px 13px',
                                  borderRadius: '4px',
                                  border: `1.5px solid ${isSelected ? 'var(--accent, #1976D2)' : '#ccc'}`,
                                  backgroundColor: isSelected ? 'var(--accent, #1976D2)' : '#fff',
                                  color: isSelected ? '#fff' : '#333',
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                  fontWeight: isSelected ? 600 : 400,
                                  transition: 'all 0.15s',
                                }}
                              >
                                {layer}
                              </button>
                            );
                          }) : (
                            <span style={{ fontSize: '13px', color: '#999' }}>
                              {(detail.rev_entries ?? []).length > 0
                                ? '모든 Layer가 추가되었습니다.'
                                : t('request.jayer_no_layer_data')}
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label className="form-label" style={{ marginBottom: 0 }}>GDS version</label>
                        <input
                          className="form-control"
                          style={{ width: '360px' }}
                          value={revGds}
                          onChange={(e) => setRevGds(e.target.value)}
                          placeholder="GDS version 입력"
                        />
                      </div>

                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ whiteSpace: 'nowrap' }}
                        disabled={revLayersSelected.length === 0 || !revGds.trim()}
                        onClick={() => {
                          if (revLayersSelected.length === 0 || !revGds.trim()) return;
                          setDetail((prev) => ({
                            ...prev,
                            rev_entries: [...(prev.rev_entries ?? []), { layers: revLayersSelected, gds: revGds.trim() }],
                          }));
                          setRevLayersSelected([]);
                          setRevGds('');
                        }}
                      >
                        + 추가
                      </button>
                    </div>

                    {/* 추가된 항목 목록 */}
                    {(detail.rev_entries ?? []).length > 0 && (
                      <table style={{ borderCollapse: 'collapse', width: 'fit-content', marginTop: '4px', fontSize: '12px' }}>
                        <thead>
                          <tr>
                            <th style={{ border: '1px solid #ddd', padding: '4px 10px', background: '#f5f5f5', whiteSpace: 'nowrap' }}>Layer</th>
                            <th style={{ border: '1px solid #ddd', padding: '4px 10px', background: '#f5f5f5', whiteSpace: 'nowrap' }}>GDS version</th>
                            <th style={{ border: '1px solid #ddd', padding: '4px 6px', background: '#f5f5f5' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detail.rev_entries ?? []).map((entry, idx) => (
                            <tr key={idx}>
                              <td style={{ border: '1px solid #ddd', padding: '4px 10px', whiteSpace: 'nowrap' }}>{entry.layers.join(', ')}</td>
                              <td style={{ border: '1px solid #ddd', padding: '4px 10px', whiteSpace: 'nowrap' }}>{entry.gds}</td>
                              <td style={{ border: '1px solid #ddd', padding: '4px 6px', textAlign: 'center' }}>
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  style={{ fontSize: '11px', padding: '2px 7px' }}
                                  onClick={() =>
                                    setDetail((prev) => ({
                                      ...prev,
                                      rev_entries: (prev.rev_entries ?? []).filter((_, i) => i !== idx),
                                    }))
                                  }
                                >
                                  삭제
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 지도 편차 */}
        {isProdc ? (
          <div className="full-width" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <label className="form-label">{t('request.map')}<GuideBadge fk="step2_map_deviation" tk={t('guide.feat.step2_map_deviation' as never)} /></label>
            {(['top', 'bottom'] as const).map((region) => (
              <div key={region} className="flex-row" style={{ alignItems: 'flex-start', gap: '12px' }}>
                <div className="form-group" style={{ width: SELECT_W, flexShrink: 0 }}>
                  <label className="form-label" style={{ marginBottom: 4 }}>{t(`request.prodc_${region}`)}</label>
                  <select className="form-control" disabled value="변경 있음">
                    <option value="변경 있음">{t('request.map_has_change')}</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">{t('request.map_value_x')} <span className="required">*</span></label>
                  <input
                    className={`form-control${errors[`map_value_x_${region}`] ? ' error' : ''}`}
                    name={`map_value_x_${region}`}
                    value={detail[`map_value_x_${region}` as keyof DetailFormState] as string}
                    onChange={handleDetailChange}
                    disabled={isMapRegistered}
                  />
                  {errors[`map_value_x_${region}`] && <span className="form-error">{errors[`map_value_x_${region}`]}</span>}
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">{t('request.map_value_y')} <span className="required">*</span></label>
                  <input
                    className={`form-control${errors[`map_value_y_${region}`] ? ' error' : ''}`}
                    name={`map_value_y_${region}`}
                    value={detail[`map_value_y_${region}` as keyof DetailFormState] as string}
                    onChange={handleDetailChange}
                    disabled={isMapRegistered}
                  />
                  {errors[`map_value_y_${region}`] && <span className="form-error">{errors[`map_value_y_${region}`]}</span>}
                </div>
              </div>
            ))}
            <div className="form-group" style={{ flex: 3 }}>
              <label className="form-label">{t('request.map_reason')} <span className="required">*</span></label>
              <input className={`form-control${errors.map_reason ? ' error' : ''}`} name="map_reason" value={detail.map_reason} onChange={handleDetailChange} disabled={isMapRegistered} />
              {errors.map_reason && <span className="form-error">{errors.map_reason}</span>}
            </div>
          </div>
        ) : (
          <div className="full-width flex-row">
            <div className="form-group" style={{ width: SELECT_W, flexShrink: 0 }}>
              <label className="form-label">{t('request.map')}<GuideBadge fk="step2_map_deviation" tk={t('guide.feat.step2_map_deviation' as never)} /></label>
              <select className="form-control" name="map_change" value={detail.map_change} onChange={handleDetailChange} disabled={isMapRegistered}>
                <option value="변경 없음">{t('request.map_no_change')}</option>
                <option value="변경 있음">{t('request.map_has_change')}</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1, visibility: hasMapChange ? 'visible' : 'hidden' }}>
              <label className="form-label">{t('request.map_value_x')} <span className="required">*</span></label>
              <input className={`form-control${errors.map_value_x ? ' error' : ''}`} name="map_value_x" value={detail.map_value_x} onChange={handleDetailChange} disabled={isMapRegistered} />
              {errors.map_value_x && <span className="form-error">{errors.map_value_x}</span>}
            </div>
            <div className="form-group" style={{ flex: 1, visibility: hasMapChange ? 'visible' : 'hidden' }}>
              <label className="form-label">{t('request.map_value_y')} <span className="required">*</span></label>
              <input className={`form-control${errors.map_value_y ? ' error' : ''}`} name="map_value_y" value={detail.map_value_y} onChange={handleDetailChange} disabled={isMapRegistered} />
              {errors.map_value_y && <span className="form-error">{errors.map_value_y}</span>}
            </div>
            <div className="form-group" style={{ flex: 3, visibility: hasMapChange ? 'visible' : 'hidden' }}>
              <label className="form-label">{t('request.map_reason')} <span className="required">*</span></label>
              <input className={`form-control${errors.map_reason ? ' error' : ''}`} name="map_reason" value={detail.map_reason} onChange={handleDetailChange} disabled={isMapRegistered} />
              {errors.map_reason && <span className="form-error">{errors.map_reason}</span>}
            </div>
          </div>
        )}

        {/* 예외 구역 */}
        <div className="full-width flex-row">
          <div className="form-group" style={{ width: SELECT_W, flexShrink: 0 }}>
            <label className="form-label">{t('request.ea_change')}<GuideBadge fk="step2_exception_zone" tk={t('guide.feat.step2_exception_zone' as never)} /></label>
            <select className="form-control" name="ea_change" value={detail.ea_change} onChange={handleDetailChange} disabled={isMapRegistered}>
              <option value="변경 없음">{t('request.no_change')}</option>
              <option value="변경 있음">{t('request.has_change')}</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 1.5, visibility: hasEaChange ? 'visible' : 'hidden' }}>
            <label className="form-label">{t('request.ea_value')} <span className="required">*</span></label>
            <input className={`form-control${errors.ea_value ? ' error' : ''}`} name="ea_value" value={detail.ea_value} onChange={handleDetailChange} disabled={isMapRegistered} />
            {errors.ea_value && <span className="form-error">{errors.ea_value}</span>}
          </div>
          <div style={{ flex: 3.5 }} />
        </div>

        {/* X표시 변경 여부 */}
        <div className="form-group full-width">
          <label className="form-label">{t('request.mshot_change_status')}<GuideBadge fk="step2_xmark" tk={t('guide.feat.step2_xmark' as never)} /></label>
          <div style={{ width: SELECT_W }}>
            <select className="form-control" name="mshot_change" value={detail.mshot_change} onChange={handleDetailChange} disabled={isMapRegistered}>
              <option value="없음">{t('request.mshot_none')}</option>
              <option value="추가">{t('request.mshot_add')}</option>
              <option value="수정">{t('request.mshot_edit')}</option>
              <option value="삭제">{t('request.mshot_delete')}</option>
            </select>
          </div>
          {mshotDeleteMode && (
            <p style={{ color: 'red', fontWeight: 600, margin: '8px 0 0 0' }}>특정 제품 삭제 필요</p>
          )}
          {mshotEditAddMode && !isProdc && (
            <div className="form-group" style={{ width: '50%', marginTop: '8px' }}>
              <label className="form-label">{t('request.mshot_change_image_attach_area')} <span className="required">*</span></label>
              <MshotImageUpload
                fieldName="mshot_image_copy"
                value={detail.mshot_image_copy}
                error={errors.mshot_image_copy}
                disabled={isMapRegistered}
                onPaste={handleImagePaste}
              />
            </div>
          )}
          {mshotEditAddMode && isProdc && (
            <div className="form-group" style={{ marginTop: '8px' }}>
              <label className="form-label">{t('request.mshot_change_image_attach_area')}</label>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '280px' }}>
                  <div className="form-label" style={{ marginBottom: '6px' }}>{t('request.prodc_top')} <span className="required">*</span></div>
                  <MshotImageUpload
                    fieldName="mshot_image_copy_top"
                    value={detail.mshot_image_copy_top}
                    error={errors.mshot_image_copy_top}
                    disabled={isMapRegistered}
                    onPaste={handleImagePaste}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '280px' }}>
                  <div className="form-label" style={{ marginBottom: '6px' }}>{t('request.prodc_bottom')} <span className="required">*</span></div>
                  <MshotImageUpload
                    fieldName="mshot_image_copy_bottom"
                    value={detail.mshot_image_copy_bottom}
                    error={errors.mshot_image_copy_bottom}
                    disabled={isMapRegistered}
                    onPaste={handleImagePaste}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Map Option 선택 토글 버튼 */}
        {(() => {
          const mapOptions = [
            { label: t('request.map_opt_photo_backside'), name: 'photo_backside' as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_eds_backside'),   name: 'eds_backside'   as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_inter'),          name: 'inter'          as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_tsv'),            name: 'tsv'            as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_rf'),             name: 'rf'             as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_fullchip'),       name: 'fullchip'       as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_split'),          name: 'split'          as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_st'),             name: 'st'             as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_ecc'),            name: 'ecc'            as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_labelsideshot'),  name: 'labelsideshot'  as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
          ];
          return (
            <div className="full-width">
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                {t('request.map_option_title')}
                <GuideBadge fk="step2_map_options" tk={t('guide.feat.step2_map_options' as never)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, max-content)', gap: '8px' }}>
                {mapOptions.map((opt) => {
                  const isActive = detail[opt.name] === opt.activeValue;
                  const isDisabled = isMapRegistered;
                  return (
                    <button
                      key={opt.name as string}
                      type="button"
                      className={`map-option-btn${isActive ? ' active' : ''}`}
                      disabled={isDisabled}
                      onClick={() => handleDetailSet(opt.name as string, isActive ? opt.defaultValue : opt.activeValue)}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="form-section">
      <div className="form-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          🔷 {t('request.job_li')}
          <GuideBadge fk="step3_jayer_table" tk={t('guide.feat.step3_jayer_table' as never)} />
        </span>
        <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>
          활성 {jayerRows.filter(r => !r.disabled).length} / 전체 {jayerRows.length}
        </span>
      </div>
      {/* 일괄 설정 툴바 */}
      <div className="wizard-table-toolbar">
        <div className="wizard-table-toolbar-group">
          <span className="wizard-table-toolbar-label">{t('request.col_st')}:</span>
          <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('st', 'O')}>{t('request.btn_all_o')}</button>
          <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('st', 'X')}>{t('request.btn_all_x')}</button>
          <button type="button" className="th-header-btn" onClick={() => handleJayerResetField('st')}>{t('request.btn_reset')}</button>
        </div>
        <div className="wizard-table-toolbar-group">
          <span className="wizard-table-toolbar-label">{t('request.col_new_or_copy')}:</span>
          <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('new_or_copy', '신규')}>{t('request.btn_all_new')}</button>
          <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('new_or_copy', '차용')}>{t('request.btn_all_copy')}</button>
          <button type="button" className="th-header-btn" onClick={() => handleJayerResetField('new_or_copy')}>{t('request.btn_reset')}</button>
          <button
            type="button"
            className="th-header-btn"
            onClick={() => setJayerSortBySp(v => !v)}
            style={jayerSortBySp ? { background: 'var(--accent)', color: 'white' } : undefined}
          >
            STEP 정렬{jayerSortBySp ? ' ▲' : ''}
          </button>
        </div>
        <div className="wizard-table-toolbar-group" style={{ marginLeft: 'auto' }}>
          {jayerFilterSets.map(fs => (
            <button
              key={fs.id}
              type="button"
              className="th-header-btn"
              onClick={() => {
                const next = jayerActiveFilterIds.has(fs.id) ? new Set<string>() : new Set([fs.id]);
                setJayerActiveFilterIds(next);
                setJayerRows(rows => rows.map(r => ({ ...r, disabled: calcDisabled(r, jayerFilterSets, next) })));
              }}
              style={jayerActiveFilterIds.has(fs.id) ? { background: 'var(--accent)', color: 'white' } : undefined}
            >
              {fs.label}
            </button>
          ))}
          <button type="button" className="th-header-btn" onClick={() => setJayerFilterModalOpen(true)}>+ 필터</button>
          <GuideBadge fk="step3_jayer_filter" tk={t('guide.feat.step3_jayer_filter' as never)} />
        </div>
      </div>
      <div className="wizard-table-wrapper">
        <table className="wizard-table" style={{ userSelect: jayerDragInfo.current ? 'none' : undefined }}>
          <colgroup>
            <col />
            <col />
            <col />
            <col />
            <col className="sd-column" />
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th style={{ width: 32, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={jayerRows.filter(r => !r.disabled).length > 0 && jayerRows.filter(r => !r.disabled).every(r => jayerChecked.has(r.id))}
                  ref={(el) => { if (el) { const active = jayerRows.filter(r => !r.disabled); el.indeterminate = active.some(r => jayerChecked.has(r.id)) && !active.every(r => jayerChecked.has(r.id)); } }}
                  onChange={handleJayerCheckAll}
                />
              </th>
              <th style={{ width: 'auto' }}>Update 날짜</th>
              <th style={{ width: 'auto' }}>{t('request.process_id')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_sp')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_sd')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_layer')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_pp')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_st')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_new_or_copy')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_product_name')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_step')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_item_id')}</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const renderedJayerRows = [
                ...jayerRows.filter(r => !r.disabled).sort((a, b) => jayerSortBySp ? a.sp.localeCompare(b.sp) : a.sortOrder - b.sortOrder),
                ...jayerRows.filter(r => r.disabled).sort((a, b) => jayerSortBySp ? a.sp.localeCompare(b.sp) : a.sortOrder - b.sortOrder),
              ];
              const renderedJayerIds = renderedJayerRows.map(r => r.id);
              return renderedJayerRows.map((row, idx) => {
              const isFirstDisabled = row.disabled && (idx === 0 || !renderedJayerRows[idx - 1].disabled);
              const isRegistered = row.new_or_copy === '기등록';
              const regBg = '#e5e7eb';
              return (
                <>
                  {isFirstDisabled && (
                    <tr key={`divider-${row.id}`} className="row-divider"><td colSpan={13} /></tr>
                  )}
                  <tr
                    key={row.id}
                    className={[row.disabled ? 'row-disabled' : '', jayerChecked.has(row.id) ? 'row-checked' : '', mappedJayerRowIds.has(row.id) ? 'row-mapped' : ''].filter(Boolean).join(' ')}
                    onMouseEnter={() => handleJayerDragEnter(row.id, renderedJayerIds)}
                  >
                    <td style={{ textAlign: 'center' }} onMouseDown={() => handleJayerDragStart(row.id)}>
                      <input type="checkbox" checked={jayerChecked.has(row.id)} onChange={() => handleJayerCheckToggle(row.id)} />
                    </td>
                    <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.updated ?? ''} readOnly style={{ background: isRegistered ? regBg : '#f5f5f5', color: '#666' }} /></td>
                    <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.process_id} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleJayerChange(row.id, 'process_id', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                    <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.sp} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleJayerChange(row.id, 'sp', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                    <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.sd} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleJayerChange(row.id, 'sd', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                    <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.layerid ?? ''} readOnly={isRegistered} disabled={isRegistered} onChange={(e) => handleJayerChange(row.id, 'layerid', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                    <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.pp} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleJayerChange(row.id, 'pp', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : row.pp?.toLowerCase().includes('plel') ? '#fff9c4' : undefined }} /></td>
                    <td style={{ backgroundColor: isRegistered ? regBg : undefined }}>
                      <select value={row.st} disabled={row.disabled || isRegistered} onChange={(e) => handleJayerChange(row.id, 'st', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : ST_CELL_COLOR[row.st] }}>
                        <option value=""></option>
                        <option value="O">O</option>
                        <option value="O (D)">O (D)</option>
                        <option value="O (혼용)">O (혼용)</option>
                        <option value="X">X</option>
                      </select>
                    </td>
                    <td style={{ backgroundColor: isRegistered ? regBg : undefined }}>
                      <select value={row.new_or_copy} disabled={row.disabled || isRegistered} onChange={(e) => handleJayerChange(row.id, 'new_or_copy', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : row.new_or_copy === '차용' ? '#93c5fd' : row.new_or_copy === 'layer삭제' ? '#fef08a' : undefined }}>
                        <option value=""></option>
                        <option value="신규">신규</option>
                        <option value="차용">차용</option>
                        <option value="기등록">기등록</option>
                        <option value="layer삭제">layer삭제</option>
                      </select>
                    </td>
                    <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.product_name} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleJayerChange(row.id, 'product_name', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                    <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.step} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleJayerChange(row.id, 'step', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                    <td style={{ backgroundColor: isRegistered ? regBg : undefined, minWidth: 160 }}>
                      <AutocompleteInput
                        value={row.item_id}
                        onChange={(v) => handleJayerChange(row.id, 'item_id', v)}
                        options={(jayerBarcodeCache[row.id] ?? [])
                          .filter((o) => !row.step || o.n7c_layer_num.includes(row.step))
                          .map((o) => o.label)}
                        disabled={row.disabled || isRegistered}
                        style={{ backgroundColor: isRegistered ? regBg : undefined }}
                      />
                    </td>
                  </tr>
                </>
              );
              });
            })()}
          </tbody>
        </table>
      </div>
      <div className="bulk-action-row">
        <button type="button" className="flow-table-add-btn" onClick={handleJayerAddRow}>+ 행 추가</button>
        {jayerRows.filter(r => !r.disabled && jayerChecked.has(r.id)).length > 0 && (
          <button type="button" className="btn btn-danger btn-sm" onClick={handleJayerBulkDisable}>
            선택 비활성화 ({jayerRows.filter(r => !r.disabled && jayerChecked.has(r.id)).length})
          </button>
        )}
        {jayerRows.filter(r => r.disabled && jayerChecked.has(r.id)).length > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleJayerBulkRestore}>
            복원 ({jayerRows.filter(r => r.disabled && jayerChecked.has(r.id)).length})
          </button>
        )}
      </div>
    </div>
  );

  const renderStep3 = () => {
    const tbvtlvSdOptions = Array.from(
      new Set(
        oayerRows
          .filter(r => !r.disabled && (r.sd.toUpperCase().includes('TBV') || r.sd.toUpperCase().includes('TLV')))
          .map(r => r.sd)
      )
    );
    const hasTbvtlv = tbvtlvSdOptions.length > 0;
    const usedTbvtlvSds = new Set((detail.tbvtlv_entries ?? []).flatMap(e => e.sds));
    const availableTbvtlvSds = tbvtlvSdOptions.filter(sd => !usedTbvtlvSds.has(sd));
    const infoHasData = detail.partial_shot !== '' || (detail.tbvtlv_entries ?? []).length > 0 || detail.tbvtlv_thickness !== '';

    return (
      <div className="form-section">
        <div className="form-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            🔶 {t('request.ovl_li')}
            <GuideBadge fk="step4_oayer_table" tk={t('guide.feat.step4_oayer_table' as never)} />
          </span>
          <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>
            활성 {oayerRows.filter(r => !r.disabled).length} / 전체 {oayerRows.length}
          </span>
        </div>

        {/* 탭 버튼 */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '2px solid var(--border)' }}>
          {([
            { key: 'table', label: t('request.ovl_tab_table') },
            { key: 'info',  label: t('request.ovl_tab_info') },
          ] as const).map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setOayerInfoTab(tab.key)}
              style={{
                padding: '8px 20px',
                fontSize: '0.9rem',
                fontWeight: oayerInfoTab === tab.key ? 700 : 400,
                color: oayerInfoTab === tab.key ? 'var(--accent)' : 'var(--text-secondary)',
                background: 'none',
                border: 'none',
                borderBottom: oayerInfoTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -2,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {tab.label}
              {tab.key === 'info' && infoHasData && (
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4CAF50', display: 'inline-block' }} />
              )}
            </button>
          ))}
        </div>

        {/* 탭 1: OVL Layer 목록 */}
        {oayerInfoTab === 'table' && (
          <>
            <div className="wizard-table-toolbar">
              <div className="wizard-table-toolbar-group">
                <span className="wizard-table-toolbar-label">{t('request.col_st')}:</span>
                <button type="button" className="th-header-btn" onClick={() => handleOayerSetAll('st', 'O')}>{t('request.btn_all_o')}</button>
                <button type="button" className="th-header-btn" onClick={() => handleOayerSetAll('st', 'X')}>{t('request.btn_all_x')}</button>
                <button type="button" className="th-header-btn" onClick={() => handleOayerResetField('st')}>{t('request.btn_reset')}</button>
              </div>
              <div className="wizard-table-toolbar-group">
                <span className="wizard-table-toolbar-label">{t('request.col_new_or_copy')}:</span>
                <button type="button" className="th-header-btn" onClick={() => handleOayerSetAll('new_or_copy', '신규')}>{t('request.btn_all_new')}</button>
                <button type="button" className="th-header-btn" onClick={() => handleOayerSetAll('new_or_copy', '차용')}>{t('request.btn_all_copy')}</button>
                <button type="button" className="th-header-btn" onClick={() => handleOayerResetField('new_or_copy')}>{t('request.btn_reset')}</button>
                <button
                  type="button"
                  className="th-header-btn"
                  onClick={() => setOayerSortBySp(v => !v)}
                  style={oayerSortBySp ? { background: 'var(--accent)', color: 'white' } : undefined}
                >
                  STEP 정렬{oayerSortBySp ? ' ▲' : ''}
                </button>
              </div>
              <div className="wizard-table-toolbar-group" style={{ marginLeft: 'auto' }}>
                {oayerFilterSets.map(fs => (
                  <button
                    key={fs.id}
                    type="button"
                    className="th-header-btn"
                    onClick={() => {
                      const next = oayerActiveFilterIds.has(fs.id) ? new Set<string>() : new Set([fs.id]);
                      setOayerActiveFilterIds(next);
                      setOayerRows(rows => rows.map(r => ({ ...r, disabled: calcDisabled(r, oayerFilterSets, next) })));
                    }}
                    style={oayerActiveFilterIds.has(fs.id) ? { background: 'var(--accent)', color: 'white' } : undefined}
                  >
                    {fs.label}
                  </button>
                ))}
                <button type="button" className="th-header-btn" onClick={() => setOayerFilterModalOpen(true)}>+ 필터</button>
              </div>
            </div>
            <div className="wizard-table-wrapper">
              <table className="wizard-table" style={{ userSelect: oayerDragInfo.current ? 'none' : undefined }}>
                <colgroup>
                  <col /><col /><col /><col />
                  <col className="sd-column" />
                  <col /><col /><col /><col /><col /><col />
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ width: 32, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={oayerRows.filter(r => !r.disabled).length > 0 && oayerRows.filter(r => !r.disabled).every(r => oayerChecked.has(r.id))}
                        ref={(el) => { if (el) { const active = oayerRows.filter(r => !r.disabled); el.indeterminate = active.some(r => oayerChecked.has(r.id)) && !active.every(r => oayerChecked.has(r.id)); } }}
                        onChange={handleOayerCheckAll}
                      />
                    </th>
                    <th style={{ width: 'auto' }}>Update 날짜</th>
                    <th style={{ width: 'auto' }}>{t('request.process_id')}</th>
                    <th style={{ width: 'auto' }}>{t('request.col_sp')}</th>
                    <th style={{ width: 'auto' }}>{t('request.col_sd')}</th>
                    <th style={{ width: 'auto' }}>{t('request.col_pp')}</th>
                    <th style={{ width: 'auto' }}>{t('request.col_st')}</th>
                    <th style={{ width: 'auto' }}>{t('request.col_new_or_copy')}</th>
                    <th style={{ width: 'auto' }}>{t('request.col_product_name')}</th>
                    <th style={{ width: 'auto' }}>{t('request.col_step')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const renderedOayerRows = [
                      ...oayerRows.filter(r => !r.disabled).sort((a, b) => oayerSortBySp ? a.sp.localeCompare(b.sp) : a.sortOrder - b.sortOrder),
                      ...oayerRows.filter(r => r.disabled).sort((a, b) => oayerSortBySp ? a.sp.localeCompare(b.sp) : a.sortOrder - b.sortOrder),
                    ];
                    const renderedOayerIds = renderedOayerRows.map(r => r.id);
                    return renderedOayerRows.map((row, idx) => {
                      const isFirstDisabled = row.disabled && (idx === 0 || !renderedOayerRows[idx - 1].disabled);
                      const isRegistered = row.new_or_copy === '기등록';
                      const regBg = '#e5e7eb';
                      return (
                        <>
                          {isFirstDisabled && (
                            <tr key={`divider-${row.id}`} className="row-divider"><td colSpan={10} /></tr>
                          )}
                          <tr
                            key={row.id}
                            className={[row.disabled ? 'row-disabled' : '', oayerChecked.has(row.id) ? 'row-checked' : ''].filter(Boolean).join(' ')}
                            onMouseEnter={() => handleOayerDragEnter(row.id, renderedOayerIds)}
                          >
                            <td style={{ textAlign: 'center' }} onMouseDown={() => handleOayerDragStart(row.id)}>
                              <input type="checkbox" checked={oayerChecked.has(row.id)} onChange={() => handleOayerCheckToggle(row.id)} />
                            </td>
                            <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.updated ?? ''} readOnly style={{ background: isRegistered ? regBg : '#f5f5f5', color: '#666' }} /></td>
                            <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.process_id} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleOayerChange(row.id, 'process_id', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                            <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.sp} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleOayerChange(row.id, 'sp', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                            <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.sd} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleOayerChange(row.id, 'sd', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                            <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.pp} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleOayerChange(row.id, 'pp', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : row.pp?.toLowerCase().includes('plel') ? '#fff9c4' : undefined }} /></td>
                            <td style={{ backgroundColor: isRegistered ? regBg : undefined }}>
                              <select value={row.st} disabled={row.disabled || isRegistered} onChange={(e) => handleOayerChange(row.id, 'st', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : ST_CELL_COLOR[row.st] }}>
                                <option value=""></option>
                                <option value="O">O</option>
                                <option value="O (D)">O (D)</option>
                                <option value="O (혼용)">O (혼용)</option>
                                <option value="X">X</option>
                              </select>
                            </td>
                            <td style={{ backgroundColor: isRegistered ? regBg : undefined }}>
                              <select value={row.new_or_copy} disabled={row.disabled || isRegistered} onChange={(e) => handleOayerChange(row.id, 'new_or_copy', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : row.new_or_copy === '차용' ? '#93c5fd' : row.new_or_copy === 'layer삭제' ? '#fef08a' : undefined }}>
                                <option value=""></option>
                                <option value="신규">신규</option>
                                <option value="차용">차용</option>
                                <option value="기등록">기등록</option>
                                <option value="layer삭제">layer삭제</option>
                              </select>
                            </td>
                            <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.product_name} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleOayerChange(row.id, 'product_name', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                            <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.step} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleOayerChange(row.id, 'step', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                          </tr>
                        </>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
            <div className="bulk-action-row">
              <button type="button" className="flow-table-add-btn" onClick={handleOayerAddRow}>+ 행 추가</button>
              {oayerRows.filter(r => !r.disabled && oayerChecked.has(r.id)).length > 0 && (
                <button type="button" className="btn btn-danger btn-sm" onClick={handleOayerBulkDisable}>
                  선택 비활성화 ({oayerRows.filter(r => !r.disabled && oayerChecked.has(r.id)).length})
                </button>
              )}
              {oayerRows.filter(r => r.disabled && oayerChecked.has(r.id)).length > 0 && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleOayerBulkRestore}>
                  복원 ({oayerRows.filter(r => r.disabled && oayerChecked.has(r.id)).length})
                </button>
              )}
            </div>
          </>
        )}

        {/* 탭 2: OVL 정보 */}
        {oayerInfoTab === 'info' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            {/* Partial Shot 계측 필요 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <label className="form-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>
                  {t('request.partial_shot')} <span className="required">*</span>
                  <GuideBadge fk="step4_partial_shot" tk={t('guide.feat.step4_partial_shot' as never)} />
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['O', 'X'] as const).map(val => (
                    <button
                      key={val}
                      type="button"
                      className={`map-type-btn${detail.partial_shot === val ? ' active' : ''}`}
                      onClick={() => {
                        setDetail(prev => ({ ...prev, partial_shot: prev.partial_shot === val ? '' : val }));
                        if (errors['partial_shot']) setErrors(prev => ({ ...prev, partial_shot: '' }));
                      }}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>
              {errors['partial_shot'] && <span className="form-error">{errors['partial_shot']}</span>}
            </div>

            {/* TBV/TLV */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
              <label className="form-label" style={{ marginBottom: 20 }}>
                {t('request.tbvtlv')}
                <GuideBadge fk="step4_tbvtlv" tk={t('guide.feat.step4_tbvtlv' as never)} />
                {!hasTbvtlv && (
                  <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>
                    ({t('request.tbvtlv_no_data')})
                  </span>
                )}
              </label>

              {!hasTbvtlv ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('request.tbvtlv_no_data')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                  {/* 두께 입력 — 한 줄 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <label className="form-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>{t('request.tbvtlv_thickness')}</label>
                    <input
                      className="form-control"
                      style={{ width: 260 }}
                      value={detail.tbvtlv_thickness}
                      onChange={e => setDetail(prev => ({ ...prev, tbvtlv_thickness: e.target.value }))}
                      placeholder="두께 값 입력"
                    />
                  </div>

                  {/* SD 선택 (좌) + 비고·추가 (우) — 좌우 반반 */}
                  <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
                    {/* 왼쪽: SD 선택 */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label className="form-label" style={{ marginBottom: 0 }}>{t('request.tbvtlv_sd_select')}</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {availableTbvtlvSds.length > 0 ? availableTbvtlvSds.map(sd => {
                          const isSelected = tbvtlvSdsSelected[0] === sd;
                          return (
                            <button
                              key={sd}
                              type="button"
                              onClick={() => setTbvtlvSdsSelected(isSelected ? [] : [sd])}
                              style={{
                                padding: '5px 13px',
                                borderRadius: '4px',
                                border: `1.5px solid ${isSelected ? 'var(--accent, #1976D2)' : '#ccc'}`,
                                backgroundColor: isSelected ? 'var(--accent, #1976D2)' : '#fff',
                                color: isSelected ? '#fff' : '#333',
                                cursor: 'pointer',
                                fontSize: '13px',
                                fontWeight: isSelected ? 600 : 400,
                                transition: 'all 0.15s',
                              }}
                            >
                              {sd}
                            </button>
                          );
                        }) : (
                          <span style={{ fontSize: 13, color: '#999' }}>모든 SD가 추가되었습니다.</span>
                        )}
                      </div>
                    </div>

                    {/* 오른쪽: 비고 + 추가 버튼 */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label className="form-label" style={{ marginBottom: 0 }}>{t('request.tbvtlv_note')}</label>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <textarea
                          className="form-control"
                          style={{ flex: 1, minHeight: 120, resize: 'vertical' }}
                          rows={5}
                          value={tbvtlvNote}
                          onChange={e => setTbvtlvNote(e.target.value)}
                          placeholder="비고 입력"
                        />
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ whiteSpace: 'nowrap', marginTop: 2 }}
                          disabled={tbvtlvSdsSelected.length === 0}
                          onClick={() => {
                            if (tbvtlvSdsSelected.length === 0) return;
                            setDetail(prev => ({
                              ...prev,
                              tbvtlv_entries: [...(prev.tbvtlv_entries ?? []), { sds: tbvtlvSdsSelected, note: tbvtlvNote }],
                            }));
                            setTbvtlvSdsSelected([]);
                            setTbvtlvNote('');
                          }}
                        >
                          + {t('request.tbvtlv_add')}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 추가된 항목 테이블 */}
                  {(detail.tbvtlv_entries ?? []).length > 0 && (
                    <table style={{ borderCollapse: 'collapse', width: 'fit-content', fontSize: 12, marginTop: 4 }}>
                      <thead>
                        <tr>
                          <th style={{ border: '1px solid #ddd', padding: '4px 10px', background: '#f5f5f5', whiteSpace: 'nowrap' }}>{t('request.tbvtlv_sd_select')}</th>
                          <th style={{ border: '1px solid #ddd', padding: '4px 10px', background: '#f5f5f5', whiteSpace: 'nowrap' }}>{t('request.tbvtlv_note')}</th>
                          <th style={{ border: '1px solid #ddd', padding: '4px 6px', background: '#f5f5f5' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.tbvtlv_entries ?? []).map((entry, idx) => (
                          <tr key={idx}>
                            <td style={{ border: '1px solid #ddd', padding: '4px 10px', whiteSpace: 'nowrap' }}>{entry.sds.join(', ')}</td>
                            <td style={{ border: '1px solid #ddd', padding: '4px 10px', whiteSpace: 'pre-wrap' }}>{entry.note}</td>
                            <td style={{ border: '1px solid #ddd', padding: '4px 6px', textAlign: 'center' }}>
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                style={{ fontSize: 11, padding: '2px 7px' }}
                                onClick={() =>
                                  setDetail(prev => ({
                                    ...prev,
                                    tbvtlv_entries: (prev.tbvtlv_entries ?? []).filter((_, i) => i !== idx),
                                  }))
                                }
                              >
                                {t('common.delete')}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    );
  };

  const renderStep4 = () => {
    const currentTabPhotoSteps = bbExternalData[activeBbTab] ?? [];
    const currentEntry = detail.bb_entries[activeBbTab];
    const currentTabData: ExternalBbDataItem[] = currentTabPhotoSteps.map((step, idx) => ({
      id: `photo-${activeBbTab}-${idx}`,
      bb_process_id: step.processid,
      bb_name: currentEntry?.product || '',
      bb_step: step.descript,
      bb_ss: step.stepseq,
      layerid: step.layerid,
    }));

    const currentSearchQuery = bbSearchQueries[activeBbTab] || '';
    const filteredTabData = currentSearchQuery
      ? currentTabData.filter(item =>
          item.bb_process_id.toLowerCase().includes(currentSearchQuery.toLowerCase()) ||
          item.bb_name.toLowerCase().includes(currentSearchQuery.toLowerCase()) ||
          item.bb_ss.toLowerCase().includes(currentSearchQuery.toLowerCase()) ||
          item.bb_step.toLowerCase().includes(currentSearchQuery.toLowerCase()) ||
          (item.layerid || '').toLowerCase().includes(currentSearchQuery.toLowerCase())
        )
      : currentTabData;
    const stagedCount = Object.keys(stagedMappings).length;

    return (
      <div className="form-section">
        <div className="form-section-title"><span style={{ color: '#4CAF50' }}>🔷</span> {t('request.bb_li')}</div>

        {/* 자동 채움 버튼 */}
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleOpenAutoFillPanel}
            disabled={bbExternalData.length === 0 || bbExternalData.every(tab => tab.length === 0)}
          >
            📋 Backbone 자동 채움
          </button>
          {jayerRows.filter(r => !r.disabled).length > 0 && (
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {jayerRows.filter(r => !r.disabled && !mappedJayerRowIds.has(r.id)).length}행 조회됨
            </span>
          )}
          <GuideBadge fk="step5_bb_autofill" tk={t('guide.feat.step5_bb_autofill' as never)} />
        </div>

        {/* 자동 채움 패널 */}
        {showAutoFillPanel && (
          <div style={{
            marginBottom: 16,
            padding: 16,
            background: 'var(--bg-secondary)',
            borderRadius: 8,
            border: '1px solid var(--border)'
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              🔷 Layer 범위 설정
            </div>
            {bbAutoFillRanges.map((range, idx) => (
              <div
                key={range.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 8,
                  flexWrap: 'wrap'
                }}
              >
                <span style={{ fontSize: 13, minWidth: 50 }}>범위 {idx + 1}:</span>
                <select
                  value={range.layerFrom}
                  onChange={(e) => handleRangeChange(range.id, 'layerFrom', e.target.value)}
                  style={{ padding: '4px 8px', fontSize: 13, minWidth: 100 }}
                >
                  <option value="">시작 Layer</option>
                  {[...new Set(jayerRows.filter(r => !r.disabled).map(r => r.layerid).filter(Boolean))]
                    .sort((a, b) => parseFloat(a) - parseFloat(b))
                    .map(layerid => (
                      <option key={layerid} value={layerid}>{layerid}</option>
                    ))}
                </select>
                <span>~</span>
                <select
                  value={range.layerTo}
                  onChange={(e) => handleRangeChange(range.id, 'layerTo', e.target.value)}
                  style={{ padding: '4px 8px', fontSize: 13, minWidth: 100 }}
                >
                  <option value="">종료 Layer</option>
                  {[...new Set(jayerRows.filter(r => !r.disabled).map(r => r.layerid).filter(Boolean))]
                    .sort((a, b) => parseFloat(a) - parseFloat(b))
                    .map(layerid => (
                      <option key={layerid} value={layerid}>{layerid}</option>
                    ))}
                </select>
                <select
                  value={range.productId}
                  onChange={(e) => handleRangeChange(range.id, 'productId', e.target.value)}
                  style={{ padding: '4px 8px', fontSize: 13, minWidth: 120 }}
                >
                  {detail.bb_entries.map((entry, entryIdx) => (
                    <option key={entryIdx} value={entry.product}>
                      {entry.product || entry.location || `항목 ${entryIdx + 1}`}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="flow-delete-btn"
                  onClick={() => handleRemoveRange(range.id)}
                  style={{ width: 24, height: 24, padding: 0 }}
                >✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleAddRange}
                style={{ fontSize: 13, padding: '6px 12px' }}
              >
                + 범위 추가
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleApplyAutoFill}
                style={{ fontSize: 13, padding: '6px 12px' }}
              >
                ✔ 적용
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowAutoFillPanel(false);
                  setBbAutoFillRanges([]);
                }}
                style={{ fontSize: 13, padding: '6px 12px' }}
              >
                취소
              </button>
            </div>
          </div>
        )}

        {/* 분할 패널 */}
        <div className="bb-split-panel">
          {/* 왼쪽: 원본 행 목록 + 매핑 미리보기 */}
          <div className="bb-split-panel-left">
            <div className="bb-split-panel-title">
              ① 원본 데이터 목록 — 행을 클릭하면 오른쪽에서 bb 데이터 매핑 가능
            </div>
            <div className="bb-split-panel-scroll">
              {jayerRows.filter(r => !r.disabled).length === 0 ? (
                <div className="bb-split-hint">원본 layer 정보가 없습니다. Step 3를 먼저 입력하세요.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 600, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>공법</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 600, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>STEPSEQ</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 600, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>STEP 설명</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 600, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>Layer</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 600, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>Backbone Data</th>
                      <th style={{ padding: '6px 8px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, width: 28 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {jayerRows
                      .filter((row) => !mappedJayerRowIds.has(row.id))
                      .filter(r => !r.disabled).sort((a, b) => a.sortOrder - b.sortOrder).map((row) => {
                        const staged = stagedMappings[row.id];
                        const isSelected = selectedJayerRowId === row.id;
                        return (
                          <tr
                            key={row.id}
                            className={isSelected ? 'bb-jayer-selected' : ''}
                            onClick={() => setSelectedJayerRowId(row.id)}
                            style={{ cursor: 'pointer' }}
                          >
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>{row.process_id || '—'}</td>
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>{row.sp || '—'}</td>
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>{row.sd || '—'}</td>
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>{row.layerid || '—'}</td>
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>
                              {staged ? (
                                <span className="bb-staged-badge">{staged.bb_process_id} / {staged.bb_step}</span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>미선택</span>
                              )}
                            </td>
                            <td style={{ padding: '4px 6px', borderBottom: '1px solid var(--border-light)', textAlign: 'center' }}>
                              {staged && (
                                <button
                                  type="button"
                                  className="flow-delete-btn"
                                  style={{ width: 20, height: 20, fontSize: 11 }}
                                  onClick={(e) => { e.stopPropagation(); handleClearStaging(row.id); }}
                                  title="매핑 취소"
                                >✕</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* 오른쪽: bb_entries 탭별 외부 데이터 */}
          <div className="bb-split-panel-right">
            <div className="bb-split-panel-title">
              {t('request.ext_data_assign_to_jayer')}
            </div>
            <div className="bb-tab-bar">
              {detail.bb_entries.map((entry, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`bb-tab${activeBbTab === idx ? ' bb-tab-active' : ''}`}
                  onClick={() => setActiveBbTab(idx)}
                >
                  {entry.product || entry.location || `항목 ${idx + 1}`}
                </button>
              ))}
            </div>
            <div className="bb-split-panel-scroll">
              {bbExternalLoading ? (
                <div className="bb-split-loading">데이터 로드 중...</div>
              ) : currentTabData.length === 0 ? (
                <div className="bb-split-hint">
                  {currentEntry?.process_id
                    ? '해당 bb 에 대한 데이터가 없습니다.'
                    : 'Step 1에서 뼈찜 조합 조리법을 먼저 선택하세요.'}
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="검색어 입력"
                    value={bbSearchQueries[activeBbTab] || ''}
                    onChange={(e) => {
                      const newQueries = [...bbSearchQueries];
                      newQueries[activeBbTab] = e.target.value;
                      setBbSearchQueries(newQueries);
                    }}
                    style={{ marginBottom: 8, padding: '6px 10px', width: '100%', boxSizing: 'border-box' }}
                  />
                  {currentSearchQuery && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                      검색 결과: {filteredTabData.length}건
                    </div>
                  )}
                  <table className="bb-external-table">
                    <thead>
                      <tr>
                        <th>Ref.공법</th>
                        <th>Ref.PART ID</th>
                        <th>Ref.SEQ</th>
                        <th>설명</th>
                        <th>Layer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTabData.map((item) => {
                        const isStaged = selectedJayerRowId
                          ? stagedMappings[selectedJayerRowId]?.id === item.id
                          : false;
                        return (
                          <tr
                            key={item.id}
                            className={`bb-external-row${isStaged ? ' bb-external-staged' : ''}`}
                            onClick={() => handleStageMapping(item)}
                            title="클릭하면 선택된 원본 layer 에 지정됩니다"
                          >
                            <td>{item.bb_process_id}</td>
                            <td>{item.bb_name}</td>
                            <td>{item.bb_ss}</td>
                            <td>{item.bb_step}</td>
                            <td>{item.layerid || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 적용 버튼 */}
        <div className="bb-apply-row">
          <span className="bb-apply-hint">
            {stagedCount > 0
              ? `${stagedCount}개 행이 매핑됨 — 적용 버튼을 눌러 bb 정보에 반영하세요.`
              : '왼쪽에서 원본 layer 를 선택하고 오른쪽에서 bb 데이터를 클릭하여 매핑하세요.'}
          </span>
          <GuideBadge fk="step5_bb_mapping" tk={t('guide.feat.step5_bb_mapping' as never)} />
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleApplyMappings}
            disabled={stagedCount === 0}
          >
            ✔ 적용 ({stagedCount}건)
          </button>
        </div>

        {/* bb 정보 테이블 (적용 후 채워짐) */}
        <div className="bb-selected-section">
          <div className="form-section-title" style={{ fontSize: 14, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#4CAF50' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              bb 정보 (적용 결과)
              <GuideBadge fk="step5_bb_table" tk={t('guide.feat.step5_bb_table' as never)} />
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleResetBbRows}
              style={{ fontSize: 13, padding: '6px 12px' }}
            >
              🗑️ 초기화
            </button>
          </div>
          <div className="wizard-table-wrapper">
            <table className="wizard-table">
              <thead>
                <tr>
                  <th style={{ width: 32, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={bbRows.length > 0 && bbChecked.size === bbRows.length}
                      ref={(el) => { if (el) el.indeterminate = bbChecked.size > 0 && bbChecked.size < bbRows.length; }}
                      onChange={handleBbCheckAll}
                    />
                  </th>
                  <th style={{ width: 'auto' }}>{t('request.col_no')}</th>
                  <th style={{ width: 'auto' }}>{t('request.process_id')}</th>
                  <th
                    style={{ width: 'auto', cursor: 'pointer', userSelect: 'none' }}
                    onClick={handleSortBbRows}
                    title="클릭하여 SEQ 기준 오름차순 정렬"
                  >
                    {t('request.col_sp')} 🔼
                  </th>
                  <th style={{ width: 'auto' }}>{t('request.col_sd')}</th>
                  <th style={{ width: 'auto' }}>{t('request.col_bb_process_id')}</th>
                  <th style={{ width: 'auto' }}>{t('request.col_bb_partid')}</th>
                  <th style={{ width: 'auto' }}>{t('request.col_bb_layer')}</th>
                  <th style={{ width: 'auto' }}>{t('request.col_bb_stepseq')}</th>
                  <th style={{ width: 'auto' }}>{t('request.col_remark')}</th>
                </tr>
              </thead>
              <tbody>
                {bbRows.map((row, idx) => (
                  <tr key={row.id} className={bbChecked.has(row.id) ? 'row-checked' : ''}>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={bbChecked.has(row.id)} onChange={() => handleBbCheckToggle(row.id)} />
                    </td>
                    <td className="wizard-table-no">{idx + 1}</td>
                    <td><input value={row.process_id} onChange={(e) => handleBbChange(row.id, 'process_id', e.target.value)} /></td>
                    <td><input value={row.ss} onChange={(e) => handleBbChange(row.id, 'ss', e.target.value)} /></td>
                    <td><input value={row.sd} onChange={(e) => handleBbChange(row.id, 'sd', e.target.value)} /></td>
                    <td><input value={row.bb_process_id} onChange={(e) => handleBbChange(row.id, 'bb_process_id', e.target.value)} /></td>
                    <td><input value={row.bb_name} onChange={(e) => handleBbChange(row.id, 'bb_name', e.target.value)} /></td>
                    <td><input value={row.bb_step} onChange={(e) => handleBbChange(row.id, 'bb_step', e.target.value)} /></td>
                    <td><input value={row.bb_ss} onChange={(e) => handleBbChange(row.id, 'bb_ss', e.target.value)} /></td>
                    <td><input value={row.remark} onChange={(e) => handleBbChange(row.id, 'remark', e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bulk-action-row">
            <button type="button" className="flow-table-add-btn" onClick={handleBbAddRow}>+ 행 추가</button>
            {bbChecked.size > 0 && (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setDeleteConfirm({ message: `${bbChecked.size}개 항목을 원복하시겠습니까?`, onConfirm: handleBbBulkDelete })}
              >선택 원복 ({bbChecked.size})</button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ===== Main Render =====
  return (
    <div className="container page">
      <div className="page-header">
        <h1>{isEditMode ? '의뢰서 수정·재상신' : t('request.title')}</h1>
        <p>{isEditMode ? '내용을 수정한 후 재상신하면 반려 단계부터 다시 검토됩니다.' : t('request.subtitle')}</p>
      </div>

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

      {step === 1 && renderStep1()}
      {step === 2 && renderStepMap()}
      {step === 3 && renderStep2()}
      {step === 4 && renderStep3()}
      {step === 5 && renderStep4()}

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
      <Modal
        isOpen={jayerFilterModalOpen}
        onClose={() => { setJayerFilterModalOpen(false); setJayerNewFilter({ label: '', words: emptyDraftWords() }); }}
        title={t('request.jayer_filter_manage')}
        size="lg"
        style={{ width: '560px', maxWidth: '95%' }}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '12px' }}
              onClick={() => setFilterAllDeleteConfirm('jayer')}
            >
              전체 삭제
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={jayerNewFilter.words.sp.length === 0 && jayerNewFilter.words.sd.length === 0 && jayerNewFilter.words.pp.length === 0}
                onClick={() => {
                  const newSet: FilterSet = { id: String(Date.now()), label: jayerNewFilter.label || '필터', words: jayerNewFilter.words };
                  const updated = [...jayerFilterSets, newSet];
                  setJayerFilterSets(updated);
                  localStorage.setItem('jayerFilterSets', JSON.stringify(updated));
                  setJayerNewFilter({ label: '', words: emptyDraftWords() });
                  addToast(`필터 "${newSet.label}"이 추가되었습니다.`, 'success');
                }}
              >+ 추가</button>
              <button className="btn btn-secondary" onClick={() => { setJayerFilterModalOpen(false); setJayerNewFilter({ label: '', words: emptyDraftWords() }); }}>
                닫기
              </button>
            </div>
          </div>
        }
      >
        {(() => {
          const addKeyword = (field: 'sp'|'sd'|'pp', val: string) => {
            if (val && !jayerNewFilter.words[field].includes(val))
              setJayerNewFilter(p => ({ ...p, words: { ...p.words, [field]: [...p.words[field], val] } }));
          };
          const removeKeyword = (field: 'sp'|'sd'|'pp', i: number) =>
            setJayerNewFilter(p => ({ ...p, words: { ...p.words, [field]: p.words[field].filter((_,j)=>j!==i) } }));
          const keywordSection = (field: 'sp'|'sd'|'pp', label: string, color: string, bg: string) => (
            <div style={{ border: `1.5px solid ${color}22`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color, marginBottom: 6 }}>{label}</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input type="text" className="form-control" placeholder="키워드 입력 후 Enter"
                  style={{ fontSize: 13, padding: '5px 8px' }}
                  onKeyDown={(e) => { if (e.key==='Enter') { e.preventDefault(); addKeyword(field, e.currentTarget.value.trim()); e.currentTarget.value=''; } }} />
                <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px', whiteSpace: 'nowrap' }}
                  onClick={(e) => { const inp=(e.currentTarget.previousSibling as HTMLInputElement); addKeyword(field, inp.value.trim()); inp.value=''; }}>+ 추가</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 22 }}>
                {jayerNewFilter.words[field].length === 0
                  ? <span style={{ color: '#bbb', fontSize: 12 }}>없음</span>
                  : jayerNewFilter.words[field].map((k,i) => (
                    <span key={i} style={{ display:'inline-flex', alignItems:'center', background: bg, padding:'2px 8px', borderRadius:12, fontSize:12 }}>
                      {k}<button type="button" onClick={()=>removeKeyword(field,i)} style={{ marginLeft:4, border:'none', background:'none', cursor:'pointer', color:'#888', padding:0, fontSize:11, lineHeight:1 }}>✕</button>
                    </span>
                  ))}
              </div>
            </div>
          );
          return (
            <div style={{ fontSize: 13 }}>
              {/* 저장된 필터 목록 */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>저장된 필터</div>
                {jayerFilterSets.length === 0
                  ? <div style={{ color: '#bbb', fontSize: 13, padding: '6px 0' }}>저장된 필터가 없습니다.</div>
                  : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {jayerFilterSets.map(fs => (
                        <div key={fs.id} style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg-secondary)', padding:'8px 12px', borderRadius:8, border:'1px solid var(--border)' }}>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:600, marginBottom:3 }}>{fs.label||'(이름 없음)'}</div>
                            <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                              {fs.words.sp.map((k,i)=><span key={i} style={{ background:'#e3f2fd', padding:'1px 7px', borderRadius:10, fontSize:11 }}>🔵 {k}</span>)}
                              {fs.words.sd.map((k,i)=><span key={i} style={{ background:'#e8f5e9', padding:'1px 7px', borderRadius:10, fontSize:11 }}>🟢 {k}</span>)}
                              {fs.words.pp.map((k,i)=><span key={i} style={{ background:'#fff3e0', padding:'1px 7px', borderRadius:10, fontSize:11 }}>🟠 {k}</span>)}
                            </div>
                          </div>
                          <button type="button" className="btn btn-danger btn-sm"
                            onClick={() => setFilterDeleteConfirm({ type: 'jayer', filterId: fs.id, label: fs.label })}>삭제</button>
                        </div>
                      ))}
                    </div>
                }
              </div>

              <hr style={{ margin: '14px 0', borderColor: 'var(--border)' }} />

              {/* 새 필터 만들기 */}
              <div style={{ fontWeight: 600, fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>새 필터 만들기</div>
              <input
                type="text"
                placeholder="필터 이름을 입력하세요..."
                value={jayerNewFilter.label}
                onChange={e => setJayerNewFilter(p=>({...p, label:e.target.value}))}
                style={{ width:'100%', border:'none', borderBottom:'2px solid var(--accent)', outline:'none', fontSize:17, fontWeight:700, padding:'4px 2px', marginBottom:14, background:'transparent', color:'var(--text-primary)' }}
              />
              {keywordSection('sp', '🔵 STEPSEQ', '#1976d2', '#e3f2fd')}
              {keywordSection('sd', '🟢 STEP 설명', '#388e3c', '#e8f5e9')}
              {keywordSection('pp', '🟠 PPID', '#f57c00', '#fff3e0')}
            </div>
          );
        })()}
      </Modal>

      {/* O-ayer 필터 관리 모달 */}
      <Modal
        isOpen={oayerFilterModalOpen}
        onClose={() => { setOayerFilterModalOpen(false); setOayerNewFilter({ label: '', words: emptyDraftWords() }); }}
        title={t('request.oayer_filter_manage')}
        size="lg"
        style={{ width: '560px', maxWidth: '95%' }}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '12px' }}
              onClick={() => setFilterAllDeleteConfirm('oayer')}
            >
              전체 삭제
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={oayerNewFilter.words.sp.length === 0 && oayerNewFilter.words.sd.length === 0 && oayerNewFilter.words.pp.length === 0}
                onClick={() => {
                  const newSet: FilterSet = { id: String(Date.now()), label: oayerNewFilter.label || '필터', words: oayerNewFilter.words };
                  const updated = [...oayerFilterSets, newSet];
                  setOayerFilterSets(updated);
                  localStorage.setItem('oayerFilterSets', JSON.stringify(updated));
                  setOayerNewFilter({ label: '', words: emptyDraftWords() });
                  addToast(`필터 "${newSet.label}"이 추가되었습니다.`, 'success');
                }}
              >+ 추가</button>
              <button className="btn btn-secondary" onClick={() => { setOayerFilterModalOpen(false); setOayerNewFilter({ label: '', words: emptyDraftWords() }); }}>
                닫기
              </button>
            </div>
          </div>
        }
      >
        {(() => {
          const addKeyword = (field: 'sp'|'sd'|'pp', val: string) => {
            if (val && !oayerNewFilter.words[field].includes(val))
              setOayerNewFilter(p => ({ ...p, words: { ...p.words, [field]: [...p.words[field], val] } }));
          };
          const removeKeyword = (field: 'sp'|'sd'|'pp', i: number) =>
            setOayerNewFilter(p => ({ ...p, words: { ...p.words, [field]: p.words[field].filter((_,j)=>j!==i) } }));
          const keywordSection = (field: 'sp'|'sd'|'pp', label: string, color: string, bg: string) => (
            <div style={{ border: `1.5px solid ${color}22`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color, marginBottom: 6 }}>{label}</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input type="text" className="form-control" placeholder="키워드 입력 후 Enter"
                  style={{ fontSize: 13, padding: '5px 8px' }}
                  onKeyDown={(e) => { if (e.key==='Enter') { e.preventDefault(); addKeyword(field, e.currentTarget.value.trim()); e.currentTarget.value=''; } }} />
                <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px', whiteSpace: 'nowrap' }}
                  onClick={(e) => { const inp=(e.currentTarget.previousSibling as HTMLInputElement); addKeyword(field, inp.value.trim()); inp.value=''; }}>+ 추가</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 22 }}>
                {oayerNewFilter.words[field].length === 0
                  ? <span style={{ color: '#bbb', fontSize: 12 }}>없음</span>
                  : oayerNewFilter.words[field].map((k,i) => (
                    <span key={i} style={{ display:'inline-flex', alignItems:'center', background: bg, padding:'2px 8px', borderRadius:12, fontSize:12 }}>
                      {k}<button type="button" onClick={()=>removeKeyword(field,i)} style={{ marginLeft:4, border:'none', background:'none', cursor:'pointer', color:'#888', padding:0, fontSize:11, lineHeight:1 }}>✕</button>
                    </span>
                  ))}
              </div>
            </div>
          );
          return (
            <div style={{ fontSize: 13 }}>
              {/* 저장된 필터 목록 */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>저장된 필터</div>
                {oayerFilterSets.length === 0
                  ? <div style={{ color: '#bbb', fontSize: 13, padding: '6px 0' }}>저장된 필터가 없습니다.</div>
                  : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {oayerFilterSets.map(fs => (
                        <div key={fs.id} style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg-secondary)', padding:'8px 12px', borderRadius:8, border:'1px solid var(--border)' }}>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:600, marginBottom:3 }}>{fs.label||'(이름 없음)'}</div>
                            <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                              {fs.words.sp.map((k,i)=><span key={i} style={{ background:'#e3f2fd', padding:'1px 7px', borderRadius:10, fontSize:11 }}>🔵 {k}</span>)}
                              {fs.words.sd.map((k,i)=><span key={i} style={{ background:'#e8f5e9', padding:'1px 7px', borderRadius:10, fontSize:11 }}>🟢 {k}</span>)}
                              {fs.words.pp.map((k,i)=><span key={i} style={{ background:'#fff3e0', padding:'1px 7px', borderRadius:10, fontSize:11 }}>🟠 {k}</span>)}
                            </div>
                          </div>
                          <button type="button" className="btn btn-danger btn-sm"
                            onClick={() => setFilterDeleteConfirm({ type: 'oayer', filterId: fs.id, label: fs.label })}>삭제</button>
                        </div>
                      ))}
                    </div>
                }
              </div>

              <hr style={{ margin: '14px 0', borderColor: 'var(--border)' }} />

              {/* 새 필터 만들기 */}
              <div style={{ fontWeight: 600, fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>새 필터 만들기</div>
              <input
                type="text"
                placeholder="필터 이름을 입력하세요..."
                value={oayerNewFilter.label}
                onChange={e => setOayerNewFilter(p=>({...p, label:e.target.value}))}
                style={{ width:'100%', border:'none', borderBottom:'2px solid var(--accent)', outline:'none', fontSize:17, fontWeight:700, padding:'4px 2px', marginBottom:14, background:'transparent', color:'var(--text-primary)' }}
              />
              {keywordSection('sp', '🔵 STEPSEQ', '#1976d2', '#e3f2fd')}
              {keywordSection('sd', '🟢 STEP 설명', '#388e3c', '#e8f5e9')}
              {keywordSection('pp', '🟠 PPID', '#f57c00', '#fff3e0')}
            </div>
          );
        })()}
      </Modal>

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
        title={t('request.submit')}
        size="md"
        style={{ maxWidth: '520px' }}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
              📤 {submitting ? t('common.loading') : t('request.submit')}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">{t('request.submit_note_label')}</label>
          <textarea
            className="form-control"
            rows={5}
            placeholder={t('request.submit_note_placeholder')}
            value={submitNote}
            onChange={(e) => setSubmitNote(e.target.value)}
          />
        </div>
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
