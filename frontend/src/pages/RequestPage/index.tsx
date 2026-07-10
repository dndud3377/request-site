import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { documentsAPI, linesAPI, formOptionsAPI, uploadImageAPI, guidesAPI, usersAPI, addressBooksAPI } from '../../api/client';
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
  AddressBook,
} from '../../types';
import GuideSlidePanel from '../../components/GuideSlidePanel';
import { GUIDE_DEMO_KEYS } from '../../components/guideDemos';
import {
  OPTION_LINE,
  CRegion,
  genId,
  makeRow,
  makeBbEntry,
  makeJayerRow,
  makeOayerRow,
  makeBbRow,
  INITIAL_DETAIL,
  INITIAL_FORM,
  DETAIL_REQUIRED,
  JAYER_EDITABLE_COLS,
  OAYER_EDITABLE_COLS,
  LOADED_LOCK_COLS,
  isNocSpecial,
  makeTourDetail,
  makeTourJayerRows,
  makeTourOayerRows,
  makeTourBbRows,
  makeTourBbExternalData,
  TOUR_JAYER_PRODUCT,
  TOUR_JAYER_STEPS,
  TOUR_JAYER_ITEMS,
} from './constants';
import { formatUpdatedDate, calcDisabled, emptyDraftWords } from './helpers';
import WizardIndicator from './components/WizardIndicator';
import FilterManageModal from './components/FilterManageModal';
import Step1 from './components/Step1';
import StepMap from './components/StepMap';
import Step2 from './components/Step2';
import Step3 from './components/Step3';
import Step4 from './components/Step4';

// bb 행의 bb_name(Ref.PART ID)을 "[라인] 제품" 형식으로 만든다(라인 없으면 제품만).
const formatBbName = (location: string, product: string): string =>
  location ? `[${location}] ${product}` : product;

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

// product_name 타이핑 시 바코드 후보 조회를 디바운스하는 지연(ms). Impala 백엔드 중복 호출 감소.
const BARCODE_DEBOUNCE_MS = 300;

// 전체 가이드 되감기(seek)용 투어 상태 스냅샷 — 프리뷰가 정주행 중 챕터별로 캡처해 두었다가
// 되감을 때 그대로 복원한다. (mappedJayerRowIds는 직렬화 위해 배열로 보관)
export interface TourSnapshot {
  step: number;
  detail: DetailFormState;
  jayerRows: JayerRow[];
  bbRows: BbTableRow[];
  oayerInfoTab: 'table' | 'info';
  showAutoFillPanel: boolean;
  bbAutoFillRanges: BbAutoFillRange[];
  stagedMappings: Record<string, ExternalBbDataItem>;
  mappedJayerRowIds: string[];
  activeBbTab: number;
  confirmOpen: boolean;
  submitNote: string;
  designees: { loginid: string; name: string }[];
}

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

  // 전체 가이드 투어 모드: /request?embed=tour (&step=N) — 샘플 값이 채워진 읽기 전용 미리보기
  const tourParams = new URLSearchParams(location.search);
  const isTourMode = tourParams.get('embed') === 'tour';
  const initialTourStep = Math.min(5, Math.max(1, parseInt(tourParams.get('step') || '1', 10) || 1));

  const [lineOptions, setLineOptions] = useState<string[]>(OPTION_LINE as unknown as string[]);
  const [processOptions, setProcessOptions] = useState<string[]>([]);
  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [processIdOptions, setProcessIdOptions] = useState<string[]>([]);
  const [topProductOptions, setTopProductOptions] = useState<string[]>([]);
  const [middleProductOptions, setMiddleProductOptions] = useState<string[]>([]);
  const [bottomProductOptions, setBottomProductOptions] = useState<string[]>([]);

  // bb_entries 옵션 캐시는 위치(index)가 아니라 항목 id로 키한다(삭제 시 시프트 불필요).
  const [BbProductOptions, setBbProductOptions] = useState<Record<string, string[]>>({});
  const [BbProductidOptions, setBbProductidOptions] = useState<Record<string, string[]>>({});

  // flow_chart 옵션 캐시도 위치(index)가 아니라 행 id로 키한다(중간 행 삭제 시 시프트/깜빡임 방지 — R-12).
  const [FlowProductOptions, setFlowProductOptions] = useState<Record<string, string[]>>({});
  const [FlowProcessIdOptions, setFlowProcessIdOptions] = useState<Record<string, string[]>>({});
  const [FlowLayerIdOptions, setFlowLayerIdOptions] = useState<Record<string, string[]>>({});

  const [step, setStep] = useState(isTourMode ? initialTourStep : 1);
  const [form] = useState<CreateDocumentInput>(INITIAL_FORM);
  const [detail, setDetail] = useState<DetailFormState>(isTourMode ? makeTourDetail() : INITIAL_DETAIL);
  const [jayerRows, setJayerRows] = useState<JayerRow[]>(isTourMode ? makeTourJayerRows() : [makeJayerRow()]);
  const [jayerBarcodeCache, setJayerBarcodeCache] = useState<Record<string, { label: string; spec: string }[]>>({});
  // 바코드 후보 조회 경합/부하 방지: 행별 요청 시퀀스 토큰(최신 요청만 반영) + 타이핑 디바운스 타이머
  const barcodeReqSeq = useRef<Record<string, number>>({});
  const barcodeDebounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // 옵션 조회(연쇄 선택) 경합 방지: 조회 키별 요청 시퀀스 토큰(최신 요청 응답만 반영)
  const optionReqSeq = useRef<Record<string, number>>({});
  // 뼈찜 외부데이터: (항목,값) 조합별 결과 캐시 + 직전 조회 process_id(토스트용)
  const bbExtCache = useRef<Record<string, PhotoStepOption[]>>({});
  const bbExtPrevPid = useRef<Record<string, string>>({});
  const [oayerRows, setOayerRows] = useState<OayerRow[]>(isTourMode ? makeTourOayerRows() : [makeOayerRow()]);
  const [bbRows, setBbRows] = useState<BbTableRow[]>(isTourMode ? makeTourBbRows() : []);
  const [bbExternalData, setBbExternalData] = useState<PhotoStepOption[][]>(isTourMode ? (makeTourBbExternalData() as PhotoStepOption[][]) : []);
  // 전체 가이드 J-ayer 데모: 실제 표 위에 떠 있는 가짜 커서 + Ctrl C/V 칩
  const [tourJCursor, setTourJCursor] = useState<{ x: number; y: number } | null>(null);
  const [tourJChip, setTourJChip] = useState<{ kind: 'copy' | 'paste'; x: number; y: number } | null>(null);
  // BB 적용 버튼을 커서로 '누르는' 순간의 클릭 애니메이션 표시 여부
  const [tourJClicking, setTourJClicking] = useState(false);
  // 가이드 BB 데모에서 최신 핸들러/상태를 stale-closure 없이 호출하기 위한 참조
  const tourRef = useRef<{
    jayerRows: JayerRow[];
    bbExternalData: PhotoStepOption[][];
    handleOpenAutoFillPanel: () => void;
    handleApplyAutoFill: () => void;
    handleStageMapping: (item: ExternalBbDataItem) => void;
    handleApplyMappings: () => void;
  } | null>(null);
  // 되감기(seek) 복원용 현재 투어 상태 스냅샷 참조
  const snapStateRef = useRef<TourSnapshot | null>(null);
  const [bbExternalLoading, setBbExternalLoading] = useState(false);
  const [activeBbTab, setActiveBbTab] = useState(0);
  const [selectedJayerRowId, setSelectedJayerRowId] = useState<string | null>(null);
  const [stagedMappings, setStagedMappings] = useState<Record<string, ExternalBbDataItem>>({});
  const [mappedJayerRowIds, setMappedJayerRowIds] = useState<Set<string>>(new Set());
  const [bbAutoFillRanges, setBbAutoFillRanges] = useState<BbAutoFillRange[]>([]);
  const [showAutoFillPanel, setShowAutoFillPanel] = useState(false);
  const [bbSearchQueries, setBbSearchQueries] = useState<Record<string, string>>({});  // 탭(bb_entry id)별 검색어
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
  // 편집/지정PL 로드 실패 여부. 로드 실패 시 빈 폼으로 기존 문서를 덮어쓰는 것을 막는다(R-10).
  const [loadError, setLoadError] = useState(false);
  // 임시저장/자동저장/상신이 동시에 create()를 호출해 의뢰서가 중복 생성되는 race 방지 가드
  const isPersistingRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitNote, setSubmitNote] = useState('');
  const [savedId, setSavedId] = useState<number | null>(editDocId ?? peerReviewDocId);
  // 편집 대상 문서의 상태 — 'pause' 이면 상신 대신 '재개'(resume) 로 동작한다.
  const [editDocStatus, setEditDocStatus] = useState<string | null>(null);
  const isResumeMode = editDocStatus === 'pause';

  // 동료 PL 지정 (상신 모달) — 다중 지정(전원 합의)
  const [designees, setDesignees] = useState<{ loginid: string; name: string }[]>([]);
  const [designeeSearchQuery, setDesigneeSearchQuery] = useState('');
  const [designeeDropdownOpen, setDesigneeDropdownOpen] = useState(false);
  const [plUserOptions, setPlUserOptions] = useState<UserWithRole[]>([]);
  const designeeContainerRef = useRef<HTMLDivElement>(null);
  const [designeeError, setDesigneeError] = useState('');
  const designeeInputRef = useRef<HTMLInputElement>(null);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);

  // 통보자 다중 지정 (상신 모달) — 결재 권한 없이 상신·결재완료 메일만 받는 인원
  const [notifierUserOptions, setNotifierUserOptions] = useState<UserWithRole[]>([]);
  const [notifierSearchQuery, setNotifierSearchQuery] = useState('');
  const [notifierDropdownOpen, setNotifierDropdownOpen] = useState(false);
  const [notifierDropdownRect, setNotifierDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const notifierInputRef = useRef<HTMLInputElement>(null);
  const notifierContainerRef = useRef<HTMLDivElement>(null);

  // 주소록(통보처 프리셋) — 상신 모달에서 통보처를 세트로 저장/불러오기
  const [addressBooks, setAddressBooks] = useState<AddressBook[]>([]);
  const [abLoadOpen, setAbLoadOpen] = useState(false);
  const [abSaveOpen, setAbSaveOpen] = useState(false);
  const [abSaveMode, setAbSaveMode] = useState<'new' | number>('new'); // 'new' 또는 덮어쓸 기존 주소록 id
  const [abSaveNewName, setAbSaveNewName] = useState('');
  const [abConfirm, setAbConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  // 통보처 불러오기 — 검색 입력 + 포털 드롭다운(주소록 이름 필터)
  const [abLoadQuery, setAbLoadQuery] = useState('');
  const [abLoadRect, setAbLoadRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const abLoadInputRef = useRef<HTMLInputElement>(null);
  const prevParsedRef = useRef<{
    detail: DetailFormState;
    jayerRows: JayerRow[];
    oayerRows: OayerRow[];
    bbRows: BbTableRow[];
    history: HistorySnapshot[];
  } | null>(null);
  // 편집/지정PL 모드에서 불러온 원본 의뢰자 — 수정/재상신 시에도 최초 작성자로 고정
  const originalRequesterRef = useRef<{ name: string; email: string; department: string } | null>(null);
  // 투어 모드에선 시드한 값이 라인/조합법 변경 reset 효과로 지워지지 않도록 로드 가드를 켠 채 시작
  const isLoadingEditRef = useRef(isTourMode);

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

  // 연쇄 선택 옵션 조회 공용 헬퍼.
  // - matchedOrLoading: 값이 부모 옵션에 "정확히" 존재할 때만 조회(편집/투어 로드 중엔 우회).
  // - fetchOptions: 키별 시퀀스 토큰으로 stale 응답을 버리고 최신 요청 결과만 반영.
  const matchedOrLoading = (opts: string[], value: string): boolean =>
    isLoadingEditRef.current || (!!value && opts.includes(value));
  const fetchOptions = (key: string, fetcher: () => Promise<string[]>, apply: (opts: string[]) => void) => {
    const seq = (optionReqSeq.current[key] ?? 0) + 1;
    optionReqSeq.current[key] = seq;
    fetcher()
      .then((opts) => { if (optionReqSeq.current[key] === seq) apply(opts); })
      .catch(() => { if (optionReqSeq.current[key] === seq) apply([]); });
  };

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
    // 하위 선택값은 부모 변경 시 즉시 초기화(이전 값과 부모 불일치 방지)
    if (!isLoadingEditRef.current) {
      setProcessIdOptions([]);
      setDetail((prev) => (prev.partid_selection || prev.process_id ? { ...prev, partid_selection: '', process_id: '' } : prev));
    }
    // 제품 조회는 조합법이 옵션에 정확히 존재할 때만(시퀀스 토큰으로 stale 응답 무시)
    if (matchedOrLoading(processOptions, detail.process_selection)) {
      fetchOptions('product', () => formOptionsAPI.getProducts(detail.line, detail.process_selection), setProductOptions);
    } else if (!isLoadingEditRef.current) {
      setProductOptions([]);
    }
  }, [detail.process_selection, processOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  // 제품이름 변경 → 조리법 fetch
  useEffect(() => {
    if (!detail.line || !detail.partid_selection) {
      if (!isLoadingEditRef.current) { setProcessIdOptions([]); }
      return;
    }
    // 하위(process_id) 즉시 초기화
    if (!isLoadingEditRef.current) {
      setDetail((prev) => (prev.process_id ? { ...prev, process_id: '' } : prev));
    }
    // 조리법 조회는 제품이 옵션에 정확히 존재할 때만
    if (matchedOrLoading(productOptions, detail.partid_selection)) {
      fetchOptions('processId', () => formOptionsAPI.getProcessId(detail.line, detail.partid_selection), setProcessIdOptions);
    } else if (!isLoadingEditRef.current) {
      setProcessIdOptions([]);
    }
  }, [detail.partid_selection, productOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isLoadingEditRef.current) return; // 편집/투어 로드 중엔 보존(저장된 J/O/bb 유지)
    // 조리법(process_id)이 비워지면 J/O 원본이 없으므로 bb 매핑 상태를 초기화하고 종료.
    if (!detail.line || !detail.process_id) {
      setBbRows([]);
      setMappedJayerRowIds(new Set());
      setStagedMappings({});
      setSelectedJayerRowId(null);
      return;
    }
    // 유효한(옵션에 존재하는) 조리법일 때만 J/O를 새로 재생성한다.
    // 부분 입력 중(미일치)엔 기존 J/O·매핑을 비우지 않는다(파괴적 동작 방지).
    if (!processIdOptions.includes(detail.process_id)) return;
    // J/O가 새 id로 재생성되므로 고아 bb 행 방지를 위해 매핑 상태 초기화
    setBbRows([]);
    setMappedJayerRowIds(new Set());
    setStagedMappings({});
    setSelectedJayerRowId(null);
    setRefDocId(null);
    setRefDocLabel('');
    setRefJayerRows([]);
    setRefOayerRows([]);
    fetchJobFileLayerAndPopulateJayer(detail.line, detail.process_id);
    fetchOvlLayerAndPopulateOayer(detail.line, detail.process_id);
  }, [detail.process_id, processIdOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!detail.other_purpose.includes('Layer 추가/삭제')) {
      setRefDocId(null);
      setRefDocLabel('');
      setRefJayerRows([]);
      setRefOayerRows([]);
    }
  }, [detail.other_purpose]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    detail.bb_entries.forEach((entry) => {
      if (!entry.location) {
        setBbProductOptions((prev) => ({ ...prev, [entry.id]: [] }));
        setBbProductidOptions((prev) => ({ ...prev, [entry.id]: [] }));
        return;
      }
      formOptionsAPI.getProducts(entry.location)
        .then((opts) => setBbProductOptions((prev) => ({ ...prev, [entry.id]: opts })))
        .catch(() => setBbProductOptions((prev) => ({ ...prev, [entry.id]: [] })));
      setBbProductidOptions((prev) => ({ ...prev, [entry.id]: [] }));
    });
  }, [detail.bb_entries.map(e => e.location).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.flow_chart.forEach((entry) => {
      if (!entry.location) {
        setFlowProductOptions((prev) => ({ ...prev, [entry.id]: [] }));
        return;
      }
      formOptionsAPI.getProducts(entry.location)
        .then((opts) => setFlowProductOptions((prev) => ({ ...prev, [entry.id]: opts })))
        .catch(() => setFlowProductOptions((prev) => ({ ...prev, [entry.id]: [] })));
    });
  }, [detail.flow_chart.map(e => e.location).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.flow_chart.forEach((entry) => {
      // 제품이 해당 행 옵션에 정확히 일치할 때만 조리법 조회(시퀀스 토큰으로 stale 무시)
      if (entry.location && matchedOrLoading(FlowProductOptions[entry.id] ?? [], entry.product_name)) {
        fetchOptions(
          `flow-pid-${entry.id}`,
          () => formOptionsAPI.getProcessId(entry.location, entry.product_name),
          (opts) => setFlowProcessIdOptions((prev) => ({ ...prev, [entry.id]: opts })),
        );
      } else {
        setFlowProcessIdOptions((prev) => ({ ...prev, [entry.id]: [] }));
      }
    });
  }, [detail.flow_chart.map(e => `${e.location}|${e.product_name}`).join(','), FlowProductOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.flow_chart.forEach((entry) => {
      // 조리법이 해당 행 옵션에 정확히 일치할 때만 Layer 조회
      if (entry.location && matchedOrLoading(FlowProcessIdOptions[entry.id] ?? [], entry.process_id)) {
        fetchOptions(
          `flow-layer-${entry.id}`,
          () => formOptionsAPI.getLayerIds(entry.location, entry.process_id),
          (opts) => setFlowLayerIdOptions((prev) => ({ ...prev, [entry.id]: opts })),
        );
      } else {
        setFlowLayerIdOptions((prev) => ({ ...prev, [entry.id]: [] }));
      }
    });
  }, [detail.flow_chart.map(e => `${e.location}|${e.process_id}`).join(','), FlowProcessIdOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.bb_entries.forEach((entry) => {
      // 제품이 해당 항목 옵션에 정확히 존재할 때만 조리법 조회(시퀀스 토큰으로 stale 무시)
      if (entry.location && matchedOrLoading(BbProductOptions[entry.id] ?? [], entry.product)) {
        fetchOptions(
          `bb-pid-${entry.id}`,
          () => formOptionsAPI.getProcessId(entry.location, entry.product),
          (opts) => setBbProductidOptions((prev) => ({ ...prev, [entry.id]: opts })),
        );
      } else {
        setBbProductidOptions((prev) => ({ ...prev, [entry.id]: [] }));
      }
    });
  }, [detail.bb_entries.map(e => `${e.id}|${e.product}`).join(','), BbProductOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  // bb_entries 외부 데이터 로드: 항목별로 제품·조리법이 옵션에 정확히 일치할 때만 조회한다.
  // (항목,값) 조합 캐시로 변경 없는 항목 재조회를 막고, 시퀀스 토큰으로 stale 응답을 버린다.
  // 토스트(나): 조리법이 새로 유효해진 항목에 대해서만 effect 결과 기준으로 안내(중복 fetch 없음).
  useEffect(() => {
    if (isTourMode) return; // 투어 모드는 시드(makeTourBbExternalData)를 유지 — API 빈 결과로 덮어쓰지 않음
    if (detail.bb_entries.length === 0) return;
    const entries = detail.bb_entries;
    const seq = (optionReqSeq.current['bb-ext'] ?? 0) + 1;
    optionReqSeq.current['bb-ext'] = seq;
    setBbExternalLoading(true);
    Promise.all(entries.map((entry) => {
      const valid = isLoadingEditRef.current || (
        (BbProductOptions[entry.id] ?? []).includes(entry.product) &&
        (BbProductidOptions[entry.id] ?? []).includes(entry.process_id)
      );
      if (!valid || !entry.process_id) return Promise.resolve([] as PhotoStepOption[]);
      const cacheKey = `${entry.id}|${entry.location}|${entry.product}|${entry.process_id}`;
      const cached = bbExtCache.current[cacheKey];
      if (cached) return Promise.resolve(cached);
      return formOptionsAPI.getBbExternalData(entry).then((res) => { bbExtCache.current[cacheKey] = res; return res; });
    }))
      .then((results) => {
        if (optionReqSeq.current['bb-ext'] !== seq) return; // 더 최신 요청이 있으면 무시(stale)
        setBbExternalData(results);
        setActiveBbTab(0);
        entries.forEach((entry, i) => {
          const validNow = !!entry.process_id && (isLoadingEditRef.current || (BbProductidOptions[entry.id] ?? []).includes(entry.process_id));
          if (!validNow) return;
          const changed = bbExtPrevPid.current[entry.id] !== entry.process_id;
          bbExtPrevPid.current[entry.id] = entry.process_id;
          if (changed && !isLoadingEditRef.current) {
            addToast(
              results[i].length > 0 ? t('request.toast_bb_auto_fill', { count: results[i].length }) : t('request.toast_bb_no_data'),
              results[i].length > 0 ? 'info' : 'warning',
            );
          }
        });
      })
      .catch(() => { if (optionReqSeq.current['bb-ext'] === seq) setBbExternalData([]); })
      .finally(() => { if (optionReqSeq.current['bb-ext'] === seq) setBbExternalLoading(false); });
  }, [detail.bb_entries.map(e => `${e.id}|${e.location}|${e.product}|${e.process_id}`).join(','), BbProductOptions, BbProductidOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleDragEnd = () => {
      jayerDragInfo.current = null;
      oayerDragInfo.current = null;
    };
    document.addEventListener('mouseup', handleDragEnd);
    return () => document.removeEventListener('mouseup', handleDragEnd);
  }, []);

  // 언마운트 시 진행 중인 바코드 디바운스 타이머 정리(불필요한 setState 방지)
  useEffect(() => {
    const timers = barcodeDebounceTimers.current;
    return () => { Object.values(timers).forEach((tm) => clearTimeout(tm)); };
  }, []);

  // TBV/TLV 항목은 활성 O-layer의 TBV/TLV SD에만 유효하다. 해당 SD 행이 비활성화/삭제/변경되면
  // 그 항목을 영구 삭제하고(R-16), 선택 중이던 draft SD도 정리한다(복원해도 되돌아오지 않음 — 사용자 결정).
  useEffect(() => {
    const activeTbvtlvSds = new Set(
      oayerRows
        .filter((r) => !r.disabled && (r.sd.toUpperCase().includes('TBV') || r.sd.toUpperCase().includes('TLV')))
        .map((r) => r.sd)
    );
    setDetail((prev) => {
      const entries = prev.tbvtlv_entries ?? [];
      if (entries.length === 0) return prev;
      const pruned = entries
        .map((e) => ({ ...e, sds: e.sds.filter((sd) => activeTbvtlvSds.has(sd)) }))
        .filter((e) => e.sds.length > 0);
      let changed = pruned.length !== entries.length;
      if (!changed) {
        for (let i = 0; i < entries.length; i += 1) {
          if (entries[i].sds.length !== pruned[i].sds.length) { changed = true; break; }
        }
      }
      return changed ? { ...prev, tbvtlv_entries: pruned } : prev;
    });
    setTbvtlvSdsSelected((prev) => {
      const next = prev.filter((sd) => activeTbvtlvSds.has(sd));
      return next.length === prev.length ? prev : next;
    });
  }, [oayerRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // 편집 모드 (반려 재상신 or 지정 PL 수정 후 상신): 기존 문서 데이터 로드
  useEffect(() => {
    const targetDocId = editDocId ?? peerReviewDocId;
    if (!targetDocId) return;
    isLoadingEditRef.current = true;
    documentsAPI.get(targetDocId).then((res) => {
      const doc = res.data;
      setEditDocStatus(doc.status);
      try {
        const parsed = JSON.parse(doc.additional_notes ?? '{}');
        prevParsedRef.current = {
          detail: parsed.detail ?? {},
          jayerRows: parsed.jayerRows ?? [],
          oayerRows: parsed.oayerRows ?? [],
          bbRows: parsed.bbRows ?? [],
          history: parsed.history ?? [],
        };
        // 원본 의뢰자 보관 — 수정/재상신 시에도 최초 작성자 유지
        originalRequesterRef.current = {
          name: doc.requester_name ?? '',
          email: doc.requester_email ?? '',
          department: doc.requester_department ?? '',
        };
        // 검토자(지정 PL) 프리필: 이전 회차에 지정했던 PL 담당자를 상신 모달에 미리 채운다(수정 가능).
        const plSteps = (doc.approval_steps ?? []).filter((s) => s.agent === 'PL');
        if (plSteps.length > 0) {
          const maxPlRound = Math.max(...plSteps.map((s) => s.round ?? 1));
          const seen = new Set<string>();
          const prevDesignees = plSteps
            .filter((s) => (s.round ?? 1) === maxPlRound && s.assignee_loginid)
            .filter((s) => !seen.has(s.assignee_loginid!) && seen.add(s.assignee_loginid!))
            .map((s) => ({ loginid: s.assignee_loginid!, name: s.assignee_name ?? s.assignee_loginid! }));
          if (prevDesignees.length > 0) setDesignees(prevDesignees);
        }
        if (doc.production_date) setProductionDate(doc.production_date);
        // 구버전 저장 문서의 bb_entries에는 id가 없으므로 로드 시 백필(React key·매핑 식별 안정화).
        // 백필된 항목 목록은 아래 bbRows의 레거시 entryIdx → entryId 링크에도 사용한다.
        const loadedBbEntries: { id: string; location: string; product: string; process_id: string }[] =
          Array.isArray(parsed.detail?.bb_entries)
            ? parsed.detail.bb_entries.map((e: { id?: string; location: string; product: string; process_id: string }) => ({ ...e, id: e.id ?? genId() }))
            : [];
        if (parsed.detail) {
          // 구버전 문서는 other_purpose 가 문자열이므로 배열로 정규화(런타임 오류 방지)
          const normalizedOtherPurpose = Array.isArray(parsed.detail.other_purpose)
            ? parsed.detail.other_purpose
            : (parsed.detail.other_purpose ? [parsed.detail.other_purpose] : []);
          setDetail({ ...parsed.detail, other_purpose: normalizedOtherPurpose, bb_entries: loadedBbEntries, notifiers: parsed.detail.notifiers ?? [] });
        }
        if (parsed.jayerRows) {
          const fSets: FilterSet[] = (() => { try { return JSON.parse(localStorage.getItem('jayerFilterSets') ?? '[]'); } catch { return []; } })();
          const savedActiveIds: Set<string> = new Set(Array.isArray(parsed.jayerActiveFilterIds) ? parsed.jayerActiveFilterIds : []);
          setJayerActiveFilterIds(savedActiveIds);
          setJayerRows(parsed.jayerRows.map((r: JayerRow) => {
            const md = r.manuallyDisabled ?? r.disabled;
            // 옛 문서(loaded 없음)는 Update 날짜로 보정: 날짜는 백엔드 자동채움에서만 채워지므로
            // 수동 행을 잘못 잠그지 않는다.
            const loaded = r.loaded ?? !!r.updated?.trim();
            return { ...r, loaded, manuallyDisabled: md, disabled: calcDisabled({ ...r, manuallyDisabled: md }, fSets, savedActiveIds) };
          }));
        }
        if (parsed.oayerRows) {
          const fSets: FilterSet[] = (() => { try { return JSON.parse(localStorage.getItem('oayerFilterSets') ?? '[]'); } catch { return []; } })();
          const savedActiveIds: Set<string> = new Set(Array.isArray(parsed.oayerActiveFilterIds) ? parsed.oayerActiveFilterIds : []);
          setOayerActiveFilterIds(savedActiveIds);
          setOayerRows(parsed.oayerRows.map((r: OayerRow) => {
            const md = r.manuallyDisabled ?? r.disabled;
            const loaded = r.loaded ?? !!r.updated?.trim();
            return { ...r, loaded, manuallyDisabled: md, disabled: calcDisabled({ ...r, manuallyDisabled: md }, fSets, savedActiveIds) };
          }));
        }
        if (parsed.bbRows) {
          // bb_step → bb_layer 필드명 변경 호환: 구버전 저장 문서 지원
          // - 아주 구버전: bb_step = layerid 값 (bb_layer 없음) → bb_layer로 마이그레이션, 새 bb_step = ''
          // - 중간 버전: bb_layer 있음, bb_step 없음 → bb_step = ''
          // - 현재 버전: 둘 다 있음
          type LegacyBbRow = Omit<BbTableRow, 'bb_layer' | 'bb_step'> & { bb_layer?: string; bb_step?: string };
          setBbRows(parsed.bbRows.map((r: LegacyBbRow) => {
            const hasBbLayer = r.bb_layer != null;
            // 레거시 행(entryId 없음, entryIdx만)은 백필된 항목 id로 링크해 위치 비의존 색상/매핑을 재현한다.
            const entryId = r.entryId ?? (r.entryIdx != null ? loadedBbEntries[r.entryIdx]?.id : undefined);
            return {
              ...r,
              entryId,
              bb_layer: r.bb_layer ?? r.bb_step ?? '',
              bb_step: hasBbLayer ? (r.bb_step ?? '') : '',
            } as BbTableRow;
          }));
          const existingJayerIds = parsed.bbRows
            .map((row: BbTableRow) => row.sourceJayerRowId)
            .filter(Boolean);
          setMappedJayerRowIds(new Set(existingJayerIds));
        }
      } catch {
        // 저장된 JSON 파싱 실패 → 조용히 빈 폼으로 두면 저장/상신 시 기존 문서를 덮어쓸 위험이 있으므로 차단
        isLoadingEditRef.current = false;
        setLoadError(true);
        addToast(t('request.edit_load_failed'), 'error');
      }
    }).catch(() => {
      // 문서 조회(네트워크) 실패 → 동일하게 덮어쓰기 방지
      isLoadingEditRef.current = false;
      setLoadError(true);
      addToast(t('request.edit_load_failed'), 'error');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDocId, peerReviewDocId]);

  // 전체 가이드 투어: 부모(GuideTourStepPreview)가 보낸 명령 수신 — 실제 상태/핸들러로 시연
  useEffect(() => {
    if (!isTourMode) return;
    let activeTok: { cancelled: boolean } | null = null;
    let paused = false;
    const rawSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    // 일시정지를 반영하는 sleep — paused 동안에는 경과 시간을 세지 않아 그 자리에서 멈추고, 재생 시 이어서 진행한다.
    const sleep = async (ms: number) => {
      let elapsed = 0;
      while (elapsed < ms) {
        if (paused) { await rawSleep(60); continue; }
        await rawSleep(60);
        elapsed += 60;
      }
    };

    const setJayerCellById = (id: string, field: keyof JayerRow, val: string) =>
      setJayerRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: val } : r)));

    const cellRect = (sel: string): DOMRect | null =>
      document.querySelector(sel)?.getBoundingClientRect() ?? null;
    // sel 위치로 커서 이동. scroll=true면 요소를 화면 안으로 스크롤해 잘리지 않게 한다.
    const moveCursor = async (sel: string, scroll = false) => {
      const el = document.querySelector(sel);
      if (el && scroll) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); await sleep(320); }
      const r = el?.getBoundingClientRect();
      if (r) setTourJCursor({ x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 });
      await sleep(480);
    };
    // 커서가 버튼을 '누르는' 연출: 버튼 눌림 효과 + 커서 클릭 리플
    const pressButton = async (sel: string) => {
      const el = document.querySelector(sel);
      setTourJClicking(true);
      el?.classList.add('tour-pressed');
      await sleep(300);
      el?.classList.remove('tour-pressed');
      setTourJClicking(false);
    };
    const showChip = (sel: string, kind: 'copy' | 'paste') => {
      const r = cellRect(sel);
      if (r) setTourJChip({ kind, x: r.right + 8, y: r.top - 6 });
    };

    // J-ayer: 실제 표 위에서 커서 이동 → 1행 입력 → 복사(Ctrl+C) → 아래로 드래그 선택 →
    // 붙여넣기(Ctrl+V) → step·item_id(바코드) 자동 채움까지 직접 연출한다.
    const runJayerAnim = async (tok: { cancelled: boolean }) => {
      const seed = makeTourJayerRows();
      setJayerRows(seed);
      setTourJChip(null);
      jayerCellSel.clearCellSelection();
      await sleep(650); if (tok.cancelled) return;

      await moveCursor('[data-jtour="product_name-0"]'); if (tok.cancelled) return;
      setJayerCellById(seed[0].id, 'product_name', TOUR_JAYER_PRODUCT);
      await sleep(550); if (tok.cancelled) return;

      // 복사
      jayerCellSel.selectCells([{ rowId: seed[0].id, col: 'product_name' }]);
      showChip('[data-jtour="product_name-0"]', 'copy');
      await sleep(950); if (tok.cancelled) return;
      setTourJChip(null);
      await sleep(250); if (tok.cancelled) return;

      // 아래로 드래그 선택
      for (let i = 1; i < seed.length; i += 1) {
        await moveCursor(`[data-jtour="product_name-${i}"]`); if (tok.cancelled) return;
        jayerCellSel.selectCells(seed.slice(1, i + 1).map((r) => ({ rowId: r.id, col: 'product_name' })));
        await sleep(260); if (tok.cancelled) return;
      }

      // 붙여넣기
      showChip(`[data-jtour="product_name-${seed.length - 1}"]`, 'paste');
      await sleep(550); if (tok.cancelled) return;
      for (let i = 1; i < seed.length; i += 1) {
        setJayerCellById(seed[i].id, 'product_name', TOUR_JAYER_PRODUCT);
        await sleep(200); if (tok.cancelled) return;
      }
      setTourJChip(null);
      jayerCellSel.clearCellSelection();
      await sleep(450); if (tok.cancelled) return;

      // step → item_id(바코드) 자동 채움
      for (let i = 0; i < seed.length; i += 1) {
        setJayerCellById(seed[i].id, 'step', TOUR_JAYER_STEPS[i]);
        setJayerCellById(seed[i].id, 'item_id', TOUR_JAYER_ITEMS[i]);
        await sleep(300); if (tok.cancelled) return;
      }
      await sleep(400);
      setTourJCursor(null);
    };

    // BB 자동 채움(설명): 패널 열기만 — 적용은 별도 단계에서 커서로 직접 누른다.
    const runBbAutofillOpen = async (tok: { cancelled: boolean }) => {
      setShowAutoFillPanel(false);
      setBbRows([]);
      setMappedJayerRowIds(new Set());
      setActiveBbTab(0);
      setTourJCursor(null);
      setTourJClicking(false);
      await sleep(500); if (tok.cancelled) return;
      tourRef.current?.handleOpenAutoFillPanel();   // 범위 1개 시드(10~50, BB제품1)
    };

    // BB 자동 채움(적용): 커서를 '적용' 버튼으로 이동(스크롤로 보이게) → 눌러서 BB제품1 3행 생성
    const runBbAutofillApply = async (tok: { cancelled: boolean }) => {
      await sleep(400); if (tok.cancelled) return;
      await moveCursor('[data-bbtour="autofill-apply"]', true); if (tok.cancelled) return;
      await sleep(250); if (tok.cancelled) return;
      await pressButton('[data-bbtour="autofill-apply"]'); if (tok.cancelled) return;
      tourRef.current?.handleApplyAutoFill();        // BB제품1 3행 생성
      await sleep(700);
      setTourJCursor(null);
    };

    // BB 매핑: 커서로 BB제품2 탭 클릭 → 원본 행(Layer 40·50) 선택 → 외부데이터 매핑 → 적용(아래에 BB제품2 행 추가)
    const runBbMapping = async (tok: { cancelled: boolean }) => {
      setTourJCursor(null);
      await sleep(500); if (tok.cancelled) return;
      // 외부 데이터 탭을 커서로 BB제품2로 전환하는 모습
      await moveCursor('[data-bbtour="bbtab-1"]'); if (tok.cancelled) return;
      setActiveBbTab(1);
      await sleep(500); if (tok.cancelled) return;

      const mapOne = async (layer: string): Promise<boolean> => {
        const target = tourRef.current?.jayerRows.find((r) => !r.disabled && r.layerid === layer);
        const ext = tourRef.current?.bbExternalData[1]?.find((s) => s.layerid === layer);
        if (!target || !ext) return false;
        await moveCursor(`[data-bbtour="jrow-${layer}"]`); if (tok.cancelled) return false;
        setSelectedJayerRowId(target.id);
        await sleep(500); if (tok.cancelled) return false;
        await moveCursor(`[data-bbtour="ext-${layer}"]`); if (tok.cancelled) return false;
        tourRef.current?.handleStageMapping({
          id: `tour-ext-${layer}`,
          bb_process_id: ext.processid,
          bb_name: 'BB제품2',
          bb_step: ext.descript,
          bb_ss: ext.stepseq,
          layerid: ext.layerid,
        });
        await sleep(700);
        return true;
      };

      if (!(await mapOne('40'))) return;
      if (tok.cancelled) return;
      await mapOne('50');
      if (tok.cancelled) return;

      await moveCursor('[data-bbtour="map-apply"]', true); if (tok.cancelled) return;
      await sleep(250); if (tok.cancelled) return;     // 적용 버튼 위에서 잠깐 멈춤
      await pressButton('[data-bbtour="map-apply"]'); if (tok.cancelled) return;
      tourRef.current?.handleApplyMappings();          // BB제품2 2행 추가 → 결과표에 두 제품 모두 반영
      await sleep(700);
      setTourJCursor(null);
    };

    const openSubmitDemo = () => {
      setSubmitNote(t('guide.tour.steps.request.flow.submit_note_sample'));
      setDesignees([{ loginid: 'tour-reviewer', name: t('guide.tour.steps.request.flow.submit_designee_sample') }]);
      setConfirmOpen(true);
    };

    // 챕터 되감기(seek) 즉시 복원: 부모(프리뷰)가 정주행 중 캡처해 둔 스냅샷을 주입한다.
    const applySnapshot = (s: TourSnapshot) => {
      setStep(s.step);
      setDetail(s.detail);
      setJayerRows(s.jayerRows);
      setBbRows(s.bbRows);
      setOayerInfoTab(s.oayerInfoTab);
      setShowAutoFillPanel(s.showAutoFillPanel);
      setBbAutoFillRanges(s.bbAutoFillRanges);
      setStagedMappings(s.stagedMappings);
      setMappedJayerRowIds(new Set(s.mappedJayerRowIds));
      setActiveBbTab(s.activeBbTab);
      setConfirmOpen(s.confirmOpen);
      setSubmitNote(s.submitNote);
      setDesignees(s.designees);
      // 임시 커서/칩 오버레이는 항상 정리
      setTourJCursor(null);
      setTourJChip(null);
      setTourJClicking(false);
    };

    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.type !== 'guide-tour-cmd') return;
      // 일시정지/재생은 진행 중인 데모를 취소하지 않고 paused 플래그만 토글한다.
      if (d.cmd === 'pause') { paused = true; return; }
      if (d.cmd === 'resume') { paused = false; return; }
      // 스냅샷 요청: 현재 투어 상태를 부모(프리뷰)로 회신한다(진행 중 데모 취소 안 함).
      if (d.cmd === 'snapshot') {
        window.parent?.postMessage(
          { type: 'guide-tour-state', index: d.index, state: snapStateRef.current },
          window.location.origin,
        );
        return;
      }
      if (activeTok) activeTok.cancelled = true;
      const tok = { cancelled: false };
      activeTok = tok;

      switch (d.cmd) {
        case 'step':
          setConfirmOpen(false);
          setShowAutoFillPanel(false);
          setTourJCursor(null);
          setTourJChip(null);
          setTourJClicking(false);
          if (typeof d.step === 'number') setStep(Math.min(5, Math.max(1, d.step)));
          break;
        case 'restore':
          // 부모가 보낸 스냅샷으로 그 챕터의 정확한 상태를 즉시 복원
          if (d.state) applySnapshot(d.state as TourSnapshot);
          break;
        case 'map-reset':
          setDetail((dd) => ({
            ...dd,
            map_type: 'NEW',
            only_prodc: 'No',
            rev_yn: '',
            rev_entries: [],
            map_change: '변경 없음',
            map_value_x: '',
            map_value_y: '',
            map_reason: '',
            ea_change: '변경 없음',
            ea_value: '',
            mshot_change: '없음',
          }));
          break;
        case 'map-deviation':
          setDetail((dd) => ({ ...dd, map_change: '변경 있음', map_value_x: '1.2', map_value_y: '0.8', map_reason: '신규 라인 보정' }));
          break;
        case 'map-exception':
          setDetail((dd) => ({ ...dd, ea_change: '변경 있음', ea_value: '예외구역 A' }));
          break;
        case 'map-xmark':
          setDetail((dd) => ({ ...dd, mshot_change: '추가' }));
          break;
        case 'jayer-anim':
          runJayerAnim(tok);
          break;
        case 'oayer-table':
          setOayerInfoTab('table');
          break;
        case 'oayer-info':
          setOayerInfoTab('info');
          break;
        case 'bb-autofill-open':
          runBbAutofillOpen(tok);
          break;
        case 'bb-autofill-apply':
          runBbAutofillApply(tok);
          break;
        case 'bb-mapping':
          runBbMapping(tok);
          break;
        case 'open-submit':
          openSubmitDemo();
          break;
        case 'submitted':
          setConfirmOpen(false);
          addToast(t('guide.tour.steps.request.flow.submitted_toast'), 'success');
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      if (activeTok) activeTok.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTourMode]);

  // 동료 PL 지정 드롭다운 외부 클릭 감지
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (designeeContainerRef.current && !designeeContainerRef.current.contains(e.target as Node)) {
        setDesigneeDropdownOpen(false);
        setDropdownRect(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 통보자 지정 드롭다운 외부 클릭 감지
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifierContainerRef.current && !notifierContainerRef.current.contains(e.target as Node)) {
        setNotifierDropdownOpen(false);
        setNotifierDropdownRect(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 지정 PL 추가/제거 (다중, 전원 합의)
  const addDesignee = (u: UserWithRole) => {
    setDesignees((prev) =>
      prev.some((d) => d.loginid === u.loginid)
        ? prev
        : [...prev, { loginid: u.loginid, name: `${u.name} (${u.deptname})` }]
    );
    setDesigneeError('');
  };
  const removeDesignee = (loginid: string) => {
    setDesignees((prev) => prev.filter((d) => d.loginid !== loginid));
  };

  // 통보자 추가/제거 — detail.notifiers(폼 상태)에 반영되어 상신 시 함께 저장된다.
  const addNotifier = (u: UserWithRole) => {
    setDetail((prev) =>
      (prev.notifiers ?? []).some((n) => n.loginid === u.loginid)
        ? prev
        : { ...prev, notifiers: [...(prev.notifiers ?? []), { loginid: u.loginid, name: u.name }] }
    );
  };
  const removeNotifier = (loginid: string) => {
    setDetail((prev) => ({ ...prev, notifiers: (prev.notifiers ?? []).filter((n) => n.loginid !== loginid) }));
  };

  // 현재 통보처 중 이메일 미등록(발송 제외) 대상 — 통보처 후보 목록(mail 포함)으로 판별
  const noMailNotifiers = (detail.notifiers ?? []).filter((n) => {
    const u = notifierUserOptions.find((o) => o.loginid === n.loginid);
    return u ? !u.mail : false;
  });

  // 주소록 불러오기 — 현재 통보처를 주소록 구성원으로 '덮어쓰기'
  const applyAddressBook = (book: AddressBook) => {
    setDetail((prev) => ({
      ...prev,
      notifiers: book.members.map((m) => ({ loginid: m.loginid, name: m.name })),
    }));
    setAbLoadOpen(false);
    const noMail = book.members.filter((m) => !m.has_mail).length;
    if (noMail > 0) {
      addToast(t('addressbook.warn_no_mail', { count: noMail }), 'warning');
    }
    addToast(t('addressbook.loaded', { name: book.name }), 'success');
  };
  const loadAddressBook = (book: AddressBook) => {
    if ((detail.notifiers ?? []).length > 0) {
      setAbConfirm({
        message: t('addressbook.load_overwrite_confirm', { name: book.name, cur: (detail.notifiers ?? []).length, next: book.member_count }),
        onConfirm: () => applyAddressBook(book),
      });
    } else {
      applyAddressBook(book);
    }
  };

  // 주소록으로 저장 — 기존 선택 시 덮어쓰기(확인), 새 이름이면 신규 생성
  const persistAddressBook = async (mode: 'create' | 'update', idOrName: number | string) => {
    const members = (detail.notifiers ?? []).map((n) => ({ loginid: n.loginid, name: n.name }));
    try {
      if (mode === 'update') {
        await addressBooksAPI.update(idOrName as number, { members });
      } else {
        await addressBooksAPI.create(idOrName as string, members);
      }
      setAddressBooks(await addressBooksAPI.list());
      setAbSaveOpen(false);
      setAbSaveNewName('');
      setAbSaveMode('new');
      addToast(t('addressbook.saved'), 'success');
    } catch {
      addToast(t('common.process_error'), 'error');
    }
  };
  const saveAddressBook = () => {
    if ((detail.notifiers ?? []).length === 0) {
      addToast(t('addressbook.empty_save'), 'warning');
      return;
    }
    if (abSaveMode !== 'new') {
      const book = addressBooks.find((b) => b.id === abSaveMode);
      if (!book) return;
      setAbConfirm({
        message: t('addressbook.save_overwrite_confirm', { name: book.name, count: (detail.notifiers ?? []).length }),
        onConfirm: () => persistAddressBook('update', book.id),
      });
      return;
    }
    const name = abSaveNewName.trim();
    if (!name) {
      addToast(t('addressbook.name_required'), 'warning');
      return;
    }
    const dup = addressBooks.find((b) => b.name === name);
    if (dup) {
      setAbConfirm({
        message: t('addressbook.save_overwrite_confirm', { name: dup.name, count: (detail.notifiers ?? []).length }),
        onConfirm: () => persistAddressBook('update', dup.id),
      });
    } else {
      persistAddressBook('create', name);
    }
  };
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

  const handleDetailSet = (name: string, value: string | string[]) => {
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
    // 이미 선택된 map_type이 있으면 "어느 값으로 바꾸든" 초기화 모달을 띄운다(R-13).
    // (기존엔 CLONE/EXISTING 전환만 초기화해 NEW로 바꿀 때 원본 등 StepMap 값이 잔존하던 버그 수정)
    if (detail.map_type) {
      setMapTypeChangeConfirm({ targetType: val });
      return;
    }
    // 첫 선택은 초기화할 것이 없으므로 바로 적용.
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
      inter_xs: INITIAL_DETAIL.inter_xs,
      inter_ys: INITIAL_DETAIL.inter_ys,
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
    const apply = (opts: string[]) => {
      if (region === 'top') setTopProductOptions(opts);
      else if (region === 'middle') setMiddleProductOptions(opts);
      else setBottomProductOptions(opts);
    };
    // 조합법 변경 시 해당 리전 제품 즉시 초기화
    setDetail((prev) => ({ ...prev, [`prodc_${region}_product`]: '' }));
    // 제품 조회는 조합법이 옵션에 정확히 존재할 때만(시퀀스 토큰으로 stale 무시)
    if (detail.line && matchedOrLoading(processOptions, value)) {
      fetchOptions(`prodc-${region}`, () => formOptionsAPI.getProducts(detail.line, value), apply);
    } else {
      apply([]);
    }
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
    if (field === 'step_from' || field === 'step_to') {
      const key = `flow_step_${id}_${field}`;
      if (errors[key]) setErrors((prev) => ({ ...prev, [key]: '' }));
    }
  };

  // 흐름도 Step(step_from/step_to): 목록에 없는 값이면 해당 필드를 에러로 표시 + 빨간 에러 토스트
  const handleFlowStepBlur = (rowId: string, field: 'step_from' | 'step_to') => {
    const row = detail.flow_chart.find((r) => r.id === rowId);
    const value = (row?.[field] || '').trim();
    const opts = FlowLayerIdOptions[rowId] || [];
    const key = `flow_step_${rowId}_${field}`;
    if (value && !opts.includes(value)) {
      setErrors((prev) => ({ ...prev, [key]: t('request.flow_step_not_in_list') }));
      addToast(t('request.flow_step_not_in_list'), 'error');
    } else if (errors[key]) {
      setErrors((prev) => ({ ...prev, [key]: '' }));
    }
  };

  // 제품 이름(partid_selection): 목록에 없는 값이면 에러 표시(문구는 Step1에서 값 존재 시 숨김) + 빨간 에러 토스트
  const handlePartidSelectionBlur = () => {
    const value = detail.partid_selection.trim();
    if (value && !productOptions.includes(value)) {
      setErrors((prev) => ({ ...prev, partid_selection: t('request.partid_not_in_list') }));
      addToast(t('request.partid_not_in_list'), 'error');
    }
  };

  const handleFlowAddRow = () => {
    setDetail((prev) => ({ ...prev, flow_chart: [...prev.flow_chart, makeRow()] }));
  };

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
          return { ...row, loaded: true, manuallyDisabled: false, disabled: calcDisabled(row, jayerFilterSets, jayerActiveFilterIds) };
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
          return { ...row, loaded: true, manuallyDisabled: false, disabled: calcDisabled(row, oayerFilterSets, oayerActiveFilterIds) };
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

  // 매핑된 J-layer 행이 수정/비활성화되면 매핑을 해제한다:
  // 해당 bb 행 제거 + mappedJayerRowIds/stagedMappings/선택 정리 → 원본 데이터 목록에 다시 노출.
  const unmapJayerRows = (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setBbRows((prev) => prev.filter((r) => !(r.sourceJayerRowId && idSet.has(r.sourceJayerRowId))));
    setMappedJayerRowIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setStagedMappings((prev) => {
      const next = { ...prev };
      ids.forEach((id) => delete next[id]);
      return next;
    });
    setSelectedJayerRowId((prev) => (prev && idSet.has(prev) ? null : prev));
  };

  // 매핑된 행만 골라 unmap (편집/붙여넣기/Delete 공용)
  const unmapIfMapped = (ids: string[]) => unmapJayerRows(ids.filter((id) => mappedJayerRowIds.has(id)));

  // 바코드 후보 조회 + 적용. seq 토큰으로 최신 요청만 반영하고(out-of-order 무시),
  // 응답 시점에 행의 product_name이 그대로일 때만 item_id를 자동 채운다.
  const runBarcodeFetch = (id: string, productName: string, seq: number) => {
    formOptionsAPI.getBarcodeOptions(productName).then((options) => {
      if (barcodeReqSeq.current[id] !== seq) return; // 더 최신 요청이 있으면 무시
      setJayerBarcodeCache((prev) => ({ ...prev, [id]: options }));
      setJayerRows((rows) => rows.map((r) =>
        r.id === id && r.product_name === productName
          ? { ...r, item_id: autoMatchItemId(r, options) }
          : r));
    });
  };

  const handleJayerChange = (id: string, field: keyof Omit<JayerRow, 'id'>, value: string) => {
    const changedRow = jayerRows.find(r => r.id === id);
    // 매핑된 행을 수정하면(어떤 컬럼이든) 매핑 해제 → 원본 목록 복귀
    if (mappedJayerRowIds.has(id)) unmapJayerRows([id]);
    // 동기화 전파 여부: 소스 행이 참여행(활성 && 기등록/layer삭제 아님)이고,
    // 전파할 값이 특수값(기등록/layer삭제)이 아닐 때만 같은 layer의 참여행으로 전파한다.
    const layerid = changedRow?.layerid?.trim();
    const sourceParticipant = !!changedRow && !changedRow.disabled && !isNocSpecial(changedRow.new_or_copy);
    const propagate = (field === 'st' || field === 'new_or_copy') && !!layerid && sourceParticipant
      && !(field === 'new_or_copy' && isNocSpecial(value));
    setJayerRows((rows) => rows.map((r) => {
      if (r.id === id) {
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
        if (field === 'new_or_copy') {
          const next = { ...r, new_or_copy: value };
          // 기등록/layer삭제 선택 시 st를 자동으로 'X'로 설정
          if (isNocSpecial(value)) next.st = 'X';
          return next;
        }
        return { ...r, [field]: value };
      }
      // J→J 동기화: 같은 layer의 "참여행"에만 반영(비활성·기등록·layer삭제 제외)
      if (propagate && r.layerid?.trim() === layerid) {
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        return { ...r, [field]: value };
      }
      return r;
    }));
    // J→O 동기화: 같은 layer의 O-layer 참여행에만 반영
    if (propagate) {
      setOayerRows(rows => rows.map(r => {
        if (r.layerid?.trim() !== layerid) return r;
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        return { ...r, [field]: value };
      }));
    }
    if (field === 'product_name') {
      // 진행 중 요청 무효화(seq +1) + 대기 중 디바운스 타이머 취소
      const seq = (barcodeReqSeq.current[id] ?? 0) + 1;
      barcodeReqSeq.current[id] = seq;
      if (barcodeDebounceTimers.current[id]) clearTimeout(barcodeDebounceTimers.current[id]);
      if (value) {
        // 타이핑 부하 감소: 행별 디바운스 후 최신 product로만 조회
        barcodeDebounceTimers.current[id] = setTimeout(() => runBarcodeFetch(id, value, seq), BARCODE_DEBOUNCE_MS);
      } else {
        setJayerBarcodeCache((prev) => ({ ...prev, [id]: [] }));
      }
    }
  };

  // 붙여넣기 후 J-layer 자동채움/바코드 조회 연동
  const handleJayerAfterPaste = (changes: { rowId: string; values: Record<string, string> }[]) => {
    // 매핑된 행에 붙여넣기 → 매핑 해제(원본 목록 복귀)
    unmapIfMapped(changes.map((c) => c.rowId));
    changes.forEach(({ rowId, values }) => {
      if ('product_name' in values) {
        const pn = values.product_name;
        if (pn) {
          // 붙여넣기는 단발 이벤트라 즉시 조회하되, seq 토큰으로 최신 요청만 반영(타이핑과 경합 방지)
          const seq = (barcodeReqSeq.current[rowId] ?? 0) + 1;
          barcodeReqSeq.current[rowId] = seq;
          if (barcodeDebounceTimers.current[rowId]) clearTimeout(barcodeDebounceTimers.current[rowId]);
          formOptionsAPI.getBarcodeOptions(pn).then((options) => {
            if (barcodeReqSeq.current[rowId] !== seq) return; // 더 최신 요청이 있으면 무시
            setJayerBarcodeCache((prev) => ({ ...prev, [rowId]: options }));
            setJayerRows((rows) => rows.map((r) => {
              if (r.id !== rowId || r.product_name !== pn) return r; // 현재 product 일치 시만
              let step = r.step;
              if (!step?.trim() && r.layerid?.trim()) step = r.layerid;
              return { ...r, step, item_id: autoMatchItemId({ ...r, step }, options) };
            }));
          });
        } else {
          barcodeReqSeq.current[rowId] = (barcodeReqSeq.current[rowId] ?? 0) + 1; // 진행 중 요청 무효화
          if (barcodeDebounceTimers.current[rowId]) clearTimeout(barcodeDebounceTimers.current[rowId]);
          setJayerBarcodeCache((prev) => ({ ...prev, [rowId]: [] }));
          setJayerRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, item_id: '' } : r)));
        }
      } else if ('step' in values) {
        const candidates = jayerBarcodeCache[rowId] ?? [];
        setJayerRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, item_id: autoMatchItemId(r, candidates) } : r)));
      }
    });
    // 기등록/layer삭제를 붙여넣은 행은 st를 자동으로 'X'로 설정
    const nocSpecialPastedIds = new Set(
      changes.filter(c => 'new_or_copy' in c.values && isNocSpecial(c.values.new_or_copy)).map(c => c.rowId)
    );
    if (nocSpecialPastedIds.size > 0) {
      setJayerRows(rows => rows.map(r => nocSpecialPastedIds.has(r.id) ? { ...r, st: 'X' } : r));
    }
    // J→J + J→O 동기화: st / new_or_copy 붙여넣기를 같은 layer의 "참여행"에만 반영
    type SyncFields = Partial<Record<'st' | 'new_or_copy', string>>;
    const layeridSyncMap = new Map<string, SyncFields>();
    const directlyPastedIds = new Set<string>();
    changes.forEach(({ rowId, values }) => {
      if (!('st' in values) && !('new_or_copy' in values)) return;
      const jRow = jayerRows.find(r => r.id === rowId);
      if (!jRow?.layerid?.trim()) return;
      directlyPastedIds.add(rowId);
      // 소스가 참여행이 아니면 전파하지 않음(비활성·기등록·layer삭제)
      if (jRow.disabled || isNocSpecial(jRow.new_or_copy)) return;
      const layerid = jRow.layerid.trim();
      const entry = layeridSyncMap.get(layerid) ?? {};
      if ('st' in values) entry.st = values.st;
      // 특수값(기등록/layer삭제)은 전파 제외
      if ('new_or_copy' in values && !isNocSpecial(values.new_or_copy)) entry.new_or_copy = values.new_or_copy;
      layeridSyncMap.set(layerid, entry);
    });
    if (layeridSyncMap.size > 0) {
      setJayerRows(rows => rows.map(r => {
        if (directlyPastedIds.has(r.id)) return r;
        const layerid = r.layerid?.trim();
        if (!layerid || !layeridSyncMap.has(layerid)) return r;
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        return { ...r, ...layeridSyncMap.get(layerid)! };
      }));
      setOayerRows(rows => rows.map(r => {
        const layerid = r.layerid?.trim();
        if (!layerid || !layeridSyncMap.has(layerid)) return r;
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        return { ...r, ...layeridSyncMap.get(layerid)! };
      }));
    }
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
    // 기등록/layer삭제를 붙여넣은 행은 st를 자동으로 'X'로 설정
    const nocSpecialPastedIds = new Set(
      changes.filter(c => 'new_or_copy' in c.values && isNocSpecial(c.values.new_or_copy)).map(c => c.rowId)
    );
    if (nocSpecialPastedIds.size > 0) {
      setOayerRows(rows => rows.map(r => nocSpecialPastedIds.has(r.id) ? { ...r, st: 'X' } : r));
    }
    // O→O + O→J 동기화: st / new_or_copy 붙여넣기를 같은 layer의 "참여행"에만 반영
    type SyncFields = Partial<Record<'st' | 'new_or_copy', string>>;
    const layeridSyncMap = new Map<string, SyncFields>();
    const directlyPastedIds = new Set<string>();
    changes.forEach(({ rowId, values }) => {
      if (!('st' in values) && !('new_or_copy' in values)) return;
      const oRow = oayerRows.find(r => r.id === rowId);
      if (!oRow?.layerid?.trim()) return;
      directlyPastedIds.add(rowId);
      // 소스가 참여행이 아니면 전파하지 않음(비활성·기등록·layer삭제)
      if (oRow.disabled || isNocSpecial(oRow.new_or_copy)) return;
      const layerid = oRow.layerid.trim();
      const entry = layeridSyncMap.get(layerid) ?? {};
      if ('st' in values) entry.st = values.st;
      // 특수값(기등록/layer삭제)은 전파 제외
      if ('new_or_copy' in values && !isNocSpecial(values.new_or_copy)) entry.new_or_copy = values.new_or_copy;
      layeridSyncMap.set(layerid, entry);
    });
    if (layeridSyncMap.size > 0) {
      setOayerRows(rows => rows.map(r => {
        if (directlyPastedIds.has(r.id)) return r;
        const layerid = r.layerid?.trim();
        if (!layerid || !layeridSyncMap.has(layerid)) return r;
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        return { ...r, ...layeridSyncMap.get(layerid)! };
      }));
      setJayerRows(rows => rows.map(r => {
        const layerid = r.layerid?.trim();
        if (!layerid || !layeridSyncMap.has(layerid)) return r;
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        return { ...r, ...layeridSyncMap.get(layerid)! };
      }));
    }
  };

  // 엑셀식 셀 선택 + 붙여넣기 (J/O 표 공용 훅). 붙여넣기 후 자동채움/바코드 조회 연동.
  // 셀 단위 잠금: 비활성/기등록 행은 전체 잠금, 불러온(loaded) 행은 LOADED_LOCK_COLS만 잠금
  const isLayerCellLocked = (row: { disabled?: boolean; new_or_copy?: string; loaded?: boolean }, col: string): boolean =>
    !!row.disabled || row.new_or_copy === '기등록' || (!!row.loaded && (LOADED_LOCK_COLS as readonly string[]).includes(col));
  const jayerCellSel = useCellSelection<JayerRow>(jayerRows, setJayerRows, JAYER_EDITABLE_COLS, handleJayerAfterPaste, isLayerCellLocked, (changes) => unmapIfMapped(changes.map((c) => c.rowId)));
  const oayerCellSel = useCellSelection<OayerRow>(oayerRows, setOayerRows, OAYER_EDITABLE_COLS, handleOayerAfterPaste, isLayerCellLocked);

  // 참여행(활성 && 기등록/layer삭제 아님)에만 일괄 적용 + 같은 layer의 O 참여행 동기화
  const handleJayerSetAll = (field: 'st' | 'new_or_copy', value: string) => {
    setJayerRows((rows) => rows.map((r) => (r.disabled || isNocSpecial(r.new_or_copy)) ? r : { ...r, [field]: value }));
    const layerids = new Set(jayerRows.filter(r => !r.disabled && !isNocSpecial(r.new_or_copy) && r.layerid?.trim()).map(r => r.layerid.trim()));
    setOayerRows(rows => rows.map(r => {
      if (!r.layerid?.trim() || !layerids.has(r.layerid.trim())) return r;
      if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
      return { ...r, [field]: value };
    }));
  };

  const handleJayerResetField = (field: 'st' | 'new_or_copy') => {
    setJayerRows((rows) => rows.map((r) => (r.disabled || isNocSpecial(r.new_or_copy)) ? r : { ...r, [field]: '' }));
    const layerids = new Set(jayerRows.filter(r => !r.disabled && !isNocSpecial(r.new_or_copy) && r.layerid?.trim()).map(r => r.layerid.trim()));
    setOayerRows(rows => rows.map(r => {
      if (!r.layerid?.trim() || !layerids.has(r.layerid.trim())) return r;
      if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
      return { ...r, [field]: '' };
    }));
  };

  const handleJayerAddRow = () => {
    setJayerRows((rows) => [...rows, makeJayerRow()]);
  };

  const handleJayerBulkDisable = () => {
    setJayerRows((rows) =>
      rows.map((r) => (jayerChecked.has(r.id) && !r.disabled ? { ...r, manuallyDisabled: true, disabled: true } : r))
    );
    // 비활성화되는 행은 매핑 해제 → bb 정보에서 제거(비활성이라 원본 목록에도 안 뜸)
    unmapJayerRows([...jayerChecked]);
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
    const changedRow = oayerRows.find(r => r.id === id);
    const layerid = changedRow?.layerid?.trim();
    const sourceParticipant = !!changedRow && !changedRow.disabled && !isNocSpecial(changedRow.new_or_copy);
    const propagate = (field === 'st' || field === 'new_or_copy') && !!layerid && sourceParticipant
      && !(field === 'new_or_copy' && isNocSpecial(value));
    setOayerRows((rows) => rows.map((r) => {
      if (r.id === id) {
        if (field === 'product_name') {
          const next = { ...r, product_name: value };
          // product_name을 채우면 step이 비어있을 때 layer 값으로 자동 채움(layer 없으면 무동작)
          if (value && !r.step?.trim() && r.layerid?.trim()) next.step = r.layerid;
          return next;
        }
        if (field === 'new_or_copy') {
          const next = { ...r, new_or_copy: value };
          // 기등록/layer삭제 선택 시 st를 자동으로 'X'로 설정
          if (isNocSpecial(value)) next.st = 'X';
          return next;
        }
        return { ...r, [field]: value };
      }
      // O→O 동기화: 같은 layer의 "참여행"에만 반영(비활성·기등록·layer삭제 제외)
      if (propagate && r.layerid?.trim() === layerid) {
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        return { ...r, [field]: value };
      }
      return r;
    }));
    // O→J 동기화: 같은 layer의 J-layer 참여행에만 반영
    if (propagate) {
      setJayerRows(rows => rows.map(r => {
        if (r.layerid?.trim() !== layerid) return r;
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        return { ...r, [field]: value };
      }));
    }
  };

  const handleOayerSetAll = (field: 'st' | 'new_or_copy', value: string) => {
    setOayerRows((rows) => rows.map((r) => (r.disabled || isNocSpecial(r.new_or_copy)) ? r : { ...r, [field]: value }));
    const layerids = new Set(oayerRows.filter(r => !r.disabled && !isNocSpecial(r.new_or_copy) && r.layerid?.trim()).map(r => r.layerid.trim()));
    setJayerRows(rows => rows.map(r => {
      if (!r.layerid?.trim() || !layerids.has(r.layerid.trim())) return r;
      if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
      return { ...r, [field]: value };
    }));
  };

  const handleOayerResetField = (field: 'st' | 'new_or_copy') => {
    setOayerRows((rows) => rows.map((r) => (r.disabled || isNocSpecial(r.new_or_copy)) ? r : { ...r, [field]: '' }));
    const layerids = new Set(oayerRows.filter(r => !r.disabled && !isNocSpecial(r.new_or_copy) && r.layerid?.trim()).map(r => r.layerid.trim()));
    setJayerRows(rows => rows.map(r => {
      if (!r.layerid?.trim() || !layerids.has(r.layerid.trim())) return r;
      if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
      return { ...r, [field]: '' };
    }));
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
        mergedJayer.push({ ...r, id: genId(), sortOrder: Date.now(), loaded: true });
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
        mergedOayer.push({ ...r, id: genId(), sortOrder: Date.now(), loaded: true });
      }
    });
    setOayerRows(mergedOayer);

    setMergeConfirmOpen(false);
    addToast(t('request.toast_merge_complete', { jayerMatched: mergeStats!.jayerMatched, oayerMatched: mergeStats!.oayerMatched, unmatched: mergeStats!.jayerUnmatchedRef + mergeStats!.oayerUnmatchedRef }), 'success');
  };

  // ===== Bb Entry Handlers (Step 1 - 뼈찜 조합 영역 다중 행) =====
  // 특정 bb_entry(id)에서 나온 결과표 행을 제거하고 그 원본 J행 매핑을 해제한다(재매핑 가능).
  // 항목 삭제/수정 시 stale 매핑이 남지 않도록 공용으로 사용.
  const clearMappedBbRowsForEntry = (entryId: string) => {
    if (!bbRows.some((r) => r.entryId === entryId)) return;
    const removedSourceJayerIds = bbRows
      .filter((r) => r.entryId === entryId && r.sourceJayerRowId)
      .map((r) => r.sourceJayerRowId as string);
    setBbRows((prev) => prev.filter((r) => r.entryId !== entryId));
    if (removedSourceJayerIds.length > 0) {
      setMappedJayerRowIds((prev) => {
        const next = new Set(prev);
        removedSourceJayerIds.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const handleBbEntryChange = (idx: number, field: 'location' | 'product' | 'process_id', value: string) => {
    const target = detail.bb_entries[idx];
    if (!target || target[field] === value) return; // 값 변경 없음 → 무동작(매핑 보존)
    // 매핑된 출처(bb_entry)를 수정하면 그 항목의 결과표 행을 정리하고 원본 J행 매핑을 해제한다.
    // → 새 제품/조리법 데이터로 다시 매핑하도록 유도(stale 데이터 방지).
    clearMappedBbRowsForEntry(target.id);
    setDetail((prev) => ({
      ...prev,
      bb_entries: prev.bb_entries.map((e, i) => (i === idx ? { ...e, [field]: value } : e)),
    }));
    // 외부데이터 조회/토스트는 외부데이터 effect가 "조리법이 옵션에 정확히 일치"할 때 한 번만 처리한다.
    // (여기서 별도 조회하던 토스트 전용 fetch는 이중 조회라 제거 — R-04)
  };

  const handleBbEntryAdd = () => {
    setDetail((prev) => ({
      ...prev,
      bb_entries: [...prev.bb_entries, makeBbEntry()],
    }));
  };

  // bb_entry 삭제: 해당 항목(id)에서 나온 결과표 행 제거 + 원본 J행 매핑 해제(재노출).
  // entryId가 안정 id이므로 인덱스 시프트가 필요 없다(옵션/검색어 캐시의 잔여 키는 안 읽혀 무해,
  // bbExternalData·activeBbTab은 [bb_entries] effect가 재조회·탭0으로 재구성).
  const handleBbEntryDelete = (idx: number) => {
    if (detail.bb_entries.length <= 1) return;
    const delId = detail.bb_entries[idx].id;
    clearMappedBbRowsForEntry(delId);
    setDetail((prev) => ({ ...prev, bb_entries: prev.bb_entries.filter((_, i) => i !== idx) }));
    setBbAutoFillRanges((prev) => prev.filter((r) => r.entryId !== delId));
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
        newRow.bb_name = formatBbName(ext.location ?? '', ext.bb_name);
        newRow.entryId = ext.entryId;
        // 자동 채움(buildAutoFillRows)과 동일하게 layer 컬럼을 외부 데이터의 layerid로 채운다.
        newRow.bb_layer = ext.layerid ?? '';
        newRow.bb_ss = ext.bb_ss;
        newRow.bb_step = ext.bb_step;
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
    // 원본 데이터 목록에 남은(미매핑) 행 기준으로 기본 범위를 시드한다.
    const layerIds = [...new Set(jayerRows.filter(r => !r.disabled && !isNocSpecial(r.new_or_copy) && !mappedJayerRowIds.has(r.id)).map(r => r.layerid).filter(Boolean))]
      .sort((a, b) => parseFloat(a) - parseFloat(b));

    // 제품이 입력된 첫 bb_entries 항목을 기본 선택값(id)으로 시드한다.
    const firstProductEntry = detail.bb_entries.find(e => e.product);

    if (layerIds.length > 0 && firstProductEntry) {
      setBbAutoFillRanges([{
        id: String(Date.now()),
        layerFrom: layerIds[0],
        layerTo: layerIds[layerIds.length - 1],
        entryId: firstProductEntry.id,
      }]);
    } else {
      setBbAutoFillRanges([]);
    }
    setShowAutoFillPanel(true);
  };

  const handleAddRange = () => {
    const seedEntry = detail.bb_entries.find(e => e.product) ?? detail.bb_entries[0];
    setBbAutoFillRanges(prev => [
      ...prev,
      {
        id: String(Date.now()),
        layerFrom: '',
        layerTo: '',
        entryId: seedEntry?.id ?? '',
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
      if (!range.layerFrom || !range.layerTo || !range.entryId) return;
      const from = parseFloat(range.layerFrom);
      const to = parseFloat(range.layerTo);
      if (isNaN(from) || isNaN(to)) return;

      const jayerRowsInRange = jayerRows.filter(row => {
        const layer = parseFloat(row.layerid);
        // 원본 데이터 목록에 남은(미매핑) 행만 자동채움 대상으로 한다.
        // 이미 채워진 행은 목록에서 빠지므로 재채움/덮어쓰기가 발생하지 않는다.
        return !row.disabled && !isNocSpecial(row.new_or_copy) && !mappedJayerRowIds.has(row.id) && !isNaN(layer) && layer >= from && layer <= to;
      });

      // 선택 항목을 안정 id로 집어 라인+제품을 유일하게 식별한다.
      // (제품명만으로 찾으면 라인만 다른 동일 제품을 구분 못 함)
      const entryPos = detail.bb_entries.findIndex(e => e.id === range.entryId);
      const entry = detail.bb_entries[entryPos];
      if (!entry || !entry.product) return;

      // 외부데이터(bbExternalData)는 위치 배열이므로 현재 위치로 인덱싱한다(매번 effect가 재구성).
      const photoSteps = bbExternalData[entryPos] ?? [];
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
          bb_name: formatBbName(entry.location, entry.product),
          bb_layer: matchedStep.layerid,
          bb_ss: matchedStep.stepseq,
          bb_step: matchedStep.descript,
          remark: '',
          entryId: entry.id,
        });
      });
    });
    return newBbRows;
  };

  // 자동채움은 "원본 목록에 남은(미매핑) 행"만 대상으로 하므로 기존 bb 행과 겹칠 수 없다.
  // 따라서 덮어쓰기/충돌 없이 항상 결과 표에 추가(append)만 한다.
  const applyBbRowChanges = (rowsToAdd: BbTableRow[]) => {
    setBbRows(prev => [...prev, ...rowsToAdd]);
    setMappedJayerRowIds(prevMapped => {
      const next = new Set(prevMapped);
      rowsToAdd.forEach(r => {
        if (r.sourceJayerRowId) next.add(r.sourceJayerRowId);
      });
      return next;
    });
    setShowAutoFillPanel(false);
    setBbAutoFillRanges([]);
    addToast(`Backbone 데이터가 ${rowsToAdd.length}행 자동 채워졌습니다.`, 'success');
  };

  const handleApplyAutoFill = () => {
    const allNewRows = buildAutoFillRows();
    if (allNewRows.length === 0) {
      if (!isTourMode) addToast('자동채움할 남은 원본 행이 없습니다.', 'info');
      return;
    }
    applyBbRowChanges(allNewRows);
  };

  const handleResetBbRows = () => {
    setBbResetConfirm(true);
  };

  const proceedResetBbRows = () => {
    setBbRows([]);
    setMappedJayerRowIds(new Set());
    addToast('Backbone 데이터가 초기화되었습니다.', 'info');
  };

  // 가이드 BB 데모가 매 렌더의 최신 핸들러/상태를 참조하도록 갱신 (stale closure 방지)
  if (isTourMode) {
    tourRef.current = {
      jayerRows,
      bbExternalData,
      handleOpenAutoFillPanel,
      handleApplyAutoFill,
      handleStageMapping,
      handleApplyMappings,
    };
    // 되감기 스냅샷용 현재 상태 — 메시지 핸들러가 stale closure 없이 회신할 수 있도록 ref에 보관
    snapStateRef.current = {
      step,
      detail,
      jayerRows,
      bbRows,
      oayerInfoTab,
      showAutoFillPanel,
      bbAutoFillRanges,
      stagedMappings,
      mappedJayerRowIds: Array.from(mappedJayerRowIds),
      activeBbTab,
      confirmOpen,
      submitNote,
      designees,
    };
  }

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
      // 제품 이름(partid_selection)은 목록에 있는 값만 허용 (값은 있으나 목록 밖이면 진행 차단)
      const partidVal = detail.partid_selection.trim();
      if (partidVal && !productOptions.includes(partidVal)) {
        newErrors['partid_selection'] = t('request.partid_not_in_list');
        errorMessages.push(t('request.partid_not_in_list'));
      }
      // Only MAP 모드에서는 Backbone 조합 영역 필수 검증을 우회한다.
      if (!isOnlyMap) {
        // 추가한 항목까지 모두 완전히(위치·제품·조리법) 입력돼야 진행 가능(R-17). 불필요하면 삭제하도록 유도.
        const allFilled = detail.bb_entries.every(
          (e) => e.location?.trim() && e.product?.trim() && e.process_id?.trim()
        );
        if (!allFilled) {
          newErrors['bb_entries'] = t('request.required');
          errorMessages.push('Backbone 조합 영역: 모든 항목을 입력하거나 불필요한 항목은 삭제하세요.');
        }
      }
      // 흐름도 Step(step_from/step_to)은 목록에 있는 값만 허용 (목록 밖 값이면 해당 필드를 표시하고 진행 차단)
      let flowStepInvalid = false;
      detail.flow_chart.forEach((row) => {
        const opts = FlowLayerIdOptions[row.id] || [];
        (['step_from', 'step_to'] as const).forEach((f) => {
          const v = (row[f] || '').trim();
          if (v && !opts.includes(v)) {
            newErrors[`flow_step_${row.id}_${f}`] = t('request.flow_step_not_in_list');
            flowStepInvalid = true;
          }
        });
      });
      if (flowStepInvalid) {
        errorMessages.push(t('request.flow_step_not_in_list'));
      }
    }

    if (currentStep === 2) {
      if (!detail.map_type?.trim()) {
        newErrors['map_type'] = t('request.required');
        errorMessages.push('MAP 요청 목적: 필수 입력 항목입니다.');
      }
      // CLONE(차용)은 원본 위치/Part ID가 필수(R-13). EXISTING/NEW는 해당 없음.
      if (detail.map_type === 'CLONE') {
        if (!detail.source_line?.trim()) {
          newErrors['source_line'] = t('request.required');
          errorMessages.push('원본 위치: 필수 입력 항목입니다.');
        }
        if (!detail.source_partid?.trim()) {
          newErrors['source_partid'] = t('request.required');
          errorMessages.push('원본 Part ID: 필수 입력 항목입니다.');
        }
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

    if (currentStep === 4 && !isOnlyMap) {
      if (!detail.partial_shot?.trim()) {
        newErrors['partial_shot'] = t('request.required');
        errorMessages.push('Partial Shot 계측 필요: 필수 선택 항목입니다.');
      }
    }

    if (currentStep === 5) {
      const unmappedJayerRows = jayerRows.filter(
        (row) => !row.disabled && !isNocSpecial(row.new_or_copy) && row.process_id && !mappedJayerRowIds.has(row.id)
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
    const purposePart = detail.other_purpose.length
      ? `${detail.request_purpose}-${detail.other_purpose.map((o) => `[${o}]`).join('')}`
      : detail.request_purpose;
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

    // 편집/지정PL 모드면 원본 의뢰자 유지, 신규 작성이면 현재 사용자
    const requester = (isEditMode || isPeerReviewMode) && originalRequesterRef.current
      ? originalRequesterRef.current
      : { name: currentUser.name, email: currentUser.email, department: currentUser.department };

    return {
      ...form,
      title,
      product_name: detail.partid_selection,
      requester_name: requester.name,
      requester_email: requester.email,
      requester_department: requester.department,
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
    if (loadError) { addToast(t('request.edit_load_failed'), 'error'); return; } // 로드 실패 시 덮어쓰기 차단(R-10)
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
      inter_xs: INITIAL_DETAIL.inter_xs,
      inter_ys: INITIAL_DETAIL.inter_ys,
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
    // 통보자 후보(전체 사용자) 로드 — 결재 권한과 무관하므로 role 필터 없음
    if (!isPeerReviewMode && notifierUserOptions.length === 0) {
      try {
        const res = await usersAPI.list();
        setNotifierUserOptions(res.data.filter(u => u.loginid !== currentUser.username));
      } catch {
        setNotifierUserOptions([]);
      }
    }
    // 내 주소록 로드(통보처 불러오기/저장용)
    if (!isPeerReviewMode) {
      try {
        setAddressBooks(await addressBooksAPI.list());
      } catch {
        setAddressBooks([]);
      }
    }
    setDesignees([]);
    setDesigneeSearchQuery('');
    setDesigneeError('');
    setNotifierSearchQuery('');
    setNotifierDropdownOpen(false);
    setNotifierDropdownRect(null);
    setAbLoadOpen(false);
    setAbSaveOpen(false);
    setConfirmOpen(true);
  };

  const handleSubmit = async () => {
    if (loadError) { addToast(t('request.edit_load_failed'), 'error'); return; } // 로드 실패 시 덮어쓰기 차단(R-10)
    // peer review·재개(resume) 모드 외 일반 상신: 지정자(1명 이상) 필수
    // (재개는 멈춘 단계부터 이어지므로 지정 PL 선택이 필요 없다)
    if (!isPeerReviewMode && !isResumeMode && designees.length === 0) {
      setDesigneeError(t('request.designee_required'));
      return;
    }
    if (isPersistingRef.current) return;
    isPersistingRef.current = true;
    setSubmitting(true);
    try {
      let docId = savedId;

      if (isPeerReviewMode) {
        // 지정 PL 수정 후 상신: history 포함본으로 1회만 저장(중복 update 제거 — R-09)
        const enriched = buildEnrichedForm(submitNote, true);
        if (!docId) {
          const res = await documentsAPI.create(enriched);
          docId = res.data.id;
          setSavedId(docId);
        } else {
          await documentsAPI.update(docId, enriched);
        }
        await documentsAPI.peerSubmit(docId!, submitNote || undefined);
        addToast('수정 후 상신되었습니다.', 'success');
      } else {
        // 기존 문서 상태 조회(신규는 draft). update는 경로당 1회.
        const currentStatus = docId ? (await documentsAPI.get(docId)).data.status : 'draft';
        const isRejected = currentStatus === 'rejected';
        const isPause = currentStatus === 'pause';
        const enriched = buildEnrichedForm(submitNote, isRejected); // 재상신일 때만 history 누적
        if (!docId) {
          const res = await documentsAPI.create(enriched);
          docId = res.data.id;
          setSavedId(docId);
        } else {
          await documentsAPI.update(docId, enriched);
        }
        if (isPause) {
          // 중단(PAUSE) 문서 재개: 멈춘 단계부터 이어진다(지정 PL 불필요).
          await documentsAPI.resume(docId!);
          addToast(t('request.resume_success'), 'success');
        } else if (isRejected) {
          // R-09: 위에서 enriched(history 포함)로 이미 1회 update했으므로 중복 update 없이 재상신
          await documentsAPI.resubmit(docId!, designees.map(d => d.loginid));
          addToast('재상신되었습니다.', 'success');
        } else {
          const submitRes = await documentsAPI.submit(docId!, designees.map(d => d.loginid));
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
          handlePartidSelectionBlur={handlePartidSelectionBlur}
          handleRequestPurposeSelect={handleRequestPurposeSelect}
          handleRefDocSelect={handleRefDocSelect}
          handleMergeClick={handleMergeClick}
          handleFlowChange={handleFlowChange}
          handleFlowStepBlur={handleFlowStepBlur}
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
          <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={saving || loadError}>
            💾 {saving ? t('common.loading') : t('request.save_draft')}
          </button>
          {step < 5 ? (
            <button className="btn btn-primary" onClick={() => handleNextStep()}>
              다음 →
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleSubmitClick} disabled={submitting || loadError}>
              📤 {submitting ? t('common.loading') : (isResumeMode ? t('approval.resume') : t('request.submit'))}
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

      {/* 주소록 저장/불러오기/삭제 확인 (상신 모달 위에 표시) */}
      <ConfirmModal
        isOpen={!!abConfirm}
        onClose={() => setAbConfirm(null)}
        onConfirm={() => abConfirm?.onConfirm()}
        title={t('common.confirm')}
        message={abConfirm?.message ?? ''}
        topLevel
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
        title={isPeerReviewMode ? t('approval.peer_submit') : isResumeMode ? t('approval.resume') : t('request.submit')}
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
              disabled={submitting || (!isPeerReviewMode && !isResumeMode && designees.length === 0)}
            >
              📤 {submitting ? t('common.loading') : (isPeerReviewMode ? t('approval.peer_submit') : isResumeMode ? t('approval.resume') : t('request.submit'))}
            </button>
          </>
        }
      >
        <div data-tour="submit-fields">
        <div className="form-group" data-tour="submit-note">
          <label className="form-label">{t('request.submit_note_label')}</label>
          <textarea
            className="form-control"
            rows={3}
            placeholder={t('request.submit_note_placeholder')}
            value={submitNote}
            onChange={(e) => setSubmitNote(e.target.value)}
          />
        </div>
        {isResumeMode && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 12 }}>
            {t('request.resume_hint')}
          </p>
        )}
        {!isPeerReviewMode && !isResumeMode && (
          <>
          <div className="form-group" data-tour="submit-designee" style={{ marginTop: 12 }}>
            <label className="form-label">
              {t('request.designee_label')} <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 6px' }}>
              {t('request.designee_help')}
            </p>
            {designees.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {designees.map((d) => (
                  <span
                    key={d.loginid}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: '0.82rem' }}
                  >
                    {d.name}
                    <button
                      type="button"
                      onClick={() => removeDesignee(d.loginid)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 2px', fontSize: '0.85rem', lineHeight: 1 }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div ref={designeeContainerRef} style={{ position: 'relative' }}>
              <input
                ref={designeeInputRef}
                className="form-control"
                placeholder={t('request.designee_placeholder')}
                value={designeeSearchQuery}
                onChange={(e) => {
                  setDesigneeSearchQuery(e.target.value);
                  setDesigneeError('');
                  setDesigneeDropdownOpen(true);
                  if (designeeInputRef.current) {
                    const r = designeeInputRef.current.getBoundingClientRect();
                    setDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                  }
                }}
                onFocus={() => {
                  setDesigneeDropdownOpen(true);
                  if (designeeInputRef.current) {
                    const r = designeeInputRef.current.getBoundingClientRect();
                    setDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                  }
                }}
                autoComplete="off"
              />
              {designeeDropdownOpen && dropdownRect && createPortal(
                <div style={{ position: 'fixed', top: dropdownRect.top, left: dropdownRect.left, width: dropdownRect.width, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', zIndex: 9999, maxHeight: 220, overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
                  {(() => {
                    const q = designeeSearchQuery.toLowerCase();
                    const filtered = plUserOptions.filter(u =>
                      !designees.some(d => d.loginid === u.loginid) &&
                      (!q ||
                        u.name.toLowerCase().includes(q) ||
                        u.loginid.toLowerCase().includes(q) ||
                        (u.mail ?? '').toLowerCase().includes(q) ||
                        (u.deptname ?? '').toLowerCase().includes(q))
                    );
                    if (filtered.length === 0) {
                      return <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>{t('request.search_no_result')}</div>;
                    }
                    return filtered.map(u => (
                      <div
                        key={u.loginid}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.875rem', borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addDesignee(u);
                          setDesigneeSearchQuery('');
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{u.name}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.75rem' }}>
                          {u.loginid}{u.mail ? ` · ${u.mail}` : ''}{u.deptname ? ` · ${u.deptname}` : ''}
                        </span>
                      </div>
                    ));
                  })()}
                </div>,
                document.body
              )}
            </div>
            {designeeError && (
              <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: 4 }}>{designeeError}</p>
            )}
          </div>

          {/* 통보자: 결재 권한 없이 상신·결재완료 메일만 받는 인원 (다중) */}
          <div className="form-group" data-tour="submit-notifier" style={{ marginTop: 12 }}>
            <label className="form-label">{t('request.notifier_label')}</label>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 6px' }}>
              {t('request.notifier_help')}
            </p>

            {/* 주소록 툴바: 통보처 불러오기 / 통보처로 저장 */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => { setAbLoadOpen((v) => !v); setAbSaveOpen(false); setAbLoadQuery(''); setAbLoadRect(null); }}
              >
                📁 {t('addressbook.load_btn')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={() => { setAbSaveOpen((v) => !v); setAbLoadOpen(false); setAbSaveMode('new'); setAbSaveNewName(''); }}
              >
                💾 {t('addressbook.save_btn')}
              </button>
            </div>

            {/* 불러오기: 검색 입력 + 포털 드롭다운(주소록 이름 필터) */}
            {abLoadOpen && (
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <input
                  ref={abLoadInputRef}
                  className="form-control"
                  placeholder={t('addressbook.search_placeholder')}
                  value={abLoadQuery}
                  autoFocus
                  autoComplete="off"
                  style={{ fontSize: '0.85rem' }}
                  onChange={(e) => {
                    setAbLoadQuery(e.target.value);
                    if (abLoadInputRef.current) {
                      const r = abLoadInputRef.current.getBoundingClientRect();
                      setAbLoadRect({ top: r.bottom + 2, left: r.left, width: r.width });
                    }
                  }}
                  onFocus={() => {
                    if (abLoadInputRef.current) {
                      const r = abLoadInputRef.current.getBoundingClientRect();
                      setAbLoadRect({ top: r.bottom + 2, left: r.left, width: r.width });
                    }
                  }}
                  onBlur={() => setTimeout(() => setAbLoadRect(null), 150)}
                />
                {abLoadRect && createPortal(
                  <div style={{ position: 'fixed', top: abLoadRect.top, left: abLoadRect.left, width: abLoadRect.width, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', zIndex: 9999, maxHeight: 280, overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
                    {(() => {
                      const q = abLoadQuery.trim().toLowerCase();
                      const filtered = addressBooks.filter((b) => !q || b.name.toLowerCase().includes(q));
                      if (filtered.length === 0) {
                        return <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{addressBooks.length === 0 ? t('addressbook.empty_list') : t('request.search_no_result')}</div>;
                      }
                      return filtered.map((b) => (
                        <div
                          key={b.id}
                          style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid var(--border)' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                          onMouseDown={(e) => { e.preventDefault(); loadAddressBook(b); }}
                        >
                          <span style={{ fontWeight: 600 }}>{b.name}</span>
                          <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.75rem' }}>{t('addressbook.member_count', { count: b.member_count })}</span>
                        </div>
                      ));
                    })()}
                  </div>,
                  document.body
                )}
              </div>
            )}

            {/* 저장 패널: 기존 주소록 선택(덮어쓰기) 또는 새 이름(추가) */}
            {abSaveOpen && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)', padding: 10, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <select
                  className="form-control"
                  value={abSaveMode === 'new' ? 'new' : String(abSaveMode)}
                  onChange={(e) => setAbSaveMode(e.target.value === 'new' ? 'new' : Number(e.target.value))}
                  style={{ fontSize: '0.85rem' }}
                >
                  <option value="new">{t('addressbook.save_as_new')}</option>
                  {addressBooks.map((b) => (
                    <option key={b.id} value={b.id}>{t('addressbook.save_overwrite_option', { name: b.name })}</option>
                  ))}
                </select>
                {abSaveMode === 'new' && (
                  <input
                    className="form-control"
                    placeholder={t('addressbook.name_placeholder')}
                    value={abSaveNewName}
                    onChange={(e) => setAbSaveNewName(e.target.value)}
                    style={{ fontSize: '0.85rem' }}
                    autoComplete="off"
                  />
                )}
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAbSaveOpen(false)}>{t('common.cancel')}</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={saveAddressBook}>{t('common.save')}</button>
                </div>
              </div>
            )}

            {(detail.notifiers ?? []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {(detail.notifiers ?? []).map((n) => (
                  <span
                    key={n.loginid}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: '0.82rem' }}
                  >
                    {n.name}
                    <button
                      type="button"
                      onClick={() => removeNotifier(n.loginid)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 2px', fontSize: '0.85rem', lineHeight: 1 }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div ref={notifierContainerRef} style={{ position: 'relative' }}>
              <input
                ref={notifierInputRef}
                className="form-control"
                placeholder={t('request.notifier_placeholder')}
                value={notifierSearchQuery}
                onChange={(e) => {
                  setNotifierSearchQuery(e.target.value);
                  setNotifierDropdownOpen(true);
                  if (notifierInputRef.current) {
                    const r = notifierInputRef.current.getBoundingClientRect();
                    setNotifierDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                  }
                }}
                onFocus={() => {
                  setNotifierDropdownOpen(true);
                  if (notifierInputRef.current) {
                    const r = notifierInputRef.current.getBoundingClientRect();
                    setNotifierDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                  }
                }}
                autoComplete="off"
              />
              {notifierDropdownOpen && notifierDropdownRect && createPortal(
                <div style={{ position: 'fixed', top: notifierDropdownRect.top, left: notifierDropdownRect.left, width: notifierDropdownRect.width, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', zIndex: 9999, maxHeight: 220, overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
                  {(() => {
                    const q = notifierSearchQuery.toLowerCase();
                    const chosen = detail.notifiers ?? [];
                    const filtered = notifierUserOptions.filter(u =>
                      !chosen.some(n => n.loginid === u.loginid) &&
                      (!q ||
                        u.name.toLowerCase().includes(q) ||
                        u.loginid.toLowerCase().includes(q) ||
                        (u.mail ?? '').toLowerCase().includes(q) ||
                        (u.deptname ?? '').toLowerCase().includes(q))
                    );
                    if (filtered.length === 0) {
                      return <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>{t('request.search_no_result')}</div>;
                    }
                    return filtered.map(u => (
                      <div
                        key={u.loginid}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.875rem', borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addNotifier(u);
                          setNotifierSearchQuery('');
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{u.name}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.75rem' }}>
                          {u.loginid}{u.mail ? ` · ${u.mail}` : ''}{u.deptname ? ` · ${u.deptname}` : ''}
                        </span>
                      </div>
                    ));
                  })()}
                </div>,
                document.body
              )}
            </div>
            {noMailNotifiers.length > 0 && (
              <p style={{ fontSize: '0.78rem', color: 'var(--warning, #b26a00)', margin: '6px 0 0', lineHeight: 1.5 }}>
                ⚠️ {t('addressbook.inline_no_mail', { count: noMailNotifiers.length, names: noMailNotifiers.map((n) => n.name).join(', ') })}
              </p>
            )}
          </div>
          </>
        )}
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
        isOpen={onlyMapConfirm}
        onClose={() => setOnlyMapConfirm(false)}
        onConfirm={handleOnlyMapConfirm}
        title={t('request.only_map_confirm_title')}
        message={t('request.only_map_confirm_msg')}
        danger
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

      {/* 전체 가이드 데모: 실제 표/패널 위에 떠 있는 가짜 커서 + 복사/붙여넣기 칩 (J-ayer step3 · BB step5) */}
      {isTourMode && (step === 3 || step === 5) && tourJCursor && (
        <div className={`tour-jcursor${tourJClicking ? ' clicking' : ''}`} style={{ transform: `translate(${tourJCursor.x}px, ${tourJCursor.y}px)` }}>
          {tourJClicking && <span className="tour-jcursor-ripple" />}
          <svg width="22" height="22" viewBox="0 0 22 22">
            <path d="M2 2 L2 17 L6.2 13 L9 19 L11.4 18 L8.6 12 L14 12 Z" fill="#fff" stroke="#1a1a2e" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      {isTourMode && step === 3 && tourJChip && (
        <div className="tour-jchip" style={{ top: tourJChip.y, left: tourJChip.x }}>
          📋 Ctrl + {tourJChip.kind === 'copy' ? 'C' : 'V'}
        </div>
      )}
    </div>
  );
}
