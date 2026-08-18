import {
  CreateDocumentInput,
  DetailFormState,
  FlowChartRow,
  JayerRow,
  OayerRow,
  BbTableRow,
  AdiCdStep,
  MergeTable,
} from '../../types';

// ===== Option Constants =====
export const OPTION_REQUEST_PURPOSE = ['신규', '차용', '신규+차용', 'Only MAP', 'MAP 삭제', '기타'] as const;
export const OPTION_LINE = ['라인1', '라인2', '라인3', '라인4', '라인5', 'nv'] as const;
export const OPTION_OTHER_PURPOSE = ['Layer 추가/삭제', 'STEPSEQ 변경', '공법 추가/변경', 'Overlay 변경', 'ADI CD 변경', 'FirstA 변경', '연구소 제품'] as const;

// 참조 요청서 Merge(+ BEFORE/AFTER 비교)를 쓸 수 있는 기타 목적.
// 여러 개를 함께 골라도 참조 요청서는 의뢰서당 1건이므로 블록은 하나만 노출한다.
export const MERGE_ENABLED_PURPOSES = ['Layer 추가/삭제', 'STEPSEQ 변경', 'Overlay 변경'] as const;

/** 기타 목적에 Merge 사용 항목이 하나라도 포함됐는가 */
export const isMergePurposeSelected = (otherPurpose: string[]): boolean =>
  otherPurpose.some((o) => (MERGE_ENABLED_PURPOSES as readonly string[]).includes(o));

// BEFORE/AFTER 표의 '미등록' 행 선택 id — 실제 행 id 와 겹치지 않도록 예약어를 쓴다.
export const MERGE_UNREGISTERED_ID = '__merge_unregistered__';

// 변경전/변경후 표에서 직접 입력할 수 있는 컬럼. layerid 는 참조 요청서에서 온 값만 표시하고
// 수기로는 채우지 않는다(읽기 전용 '—').
export const MERGE_MANUAL_FIELDS = ['process_id', 'sp', 'sd', 'pp'] as const;

// 수기로 추가한 행의 기본 구분 — 사용자가 드롭다운으로 O-ayer 로 바꿀 수 있다.
export const MERGE_DEFAULT_TABLE: MergeTable = 'J';

// 'Only MAP' 요청 목적: StepMap 정보까지만 작성하고 결재 경로도 단축된다(backend RequestDocument.ONLY_MAP_PURPOSE 와 동일 값).
export const ONLY_MAP_PURPOSE = 'Only MAP';

// 'MAP 삭제' 요청 목적: Only MAP 과 동일하게 MAP 정보만 작성하되,
// StepMap 에서 map_type 이 '삭제'로 자동 고정되고 그 이유만 입력한다(나머지 MAP 항목은 숨김).
// (2026-08) 예전에는 '수정'/'삭제' 를 고르는 'MAP 삭제' 이었다. '수정'을 없애면서
// 저장값도 'MAP 삭제' 로 바꿨다 — 백엔드 RequestDocument.MAP_DELETE_EDIT_PURPOSE 와 같은 값이어야 한다.
export const MAP_DELETE_EDIT_PURPOSE = 'MAP 삭제';

// '기타 목적 > 연구소 제품': Only MAP 일 때만 선택 가능하며, 선택 시 상신에 후결자 지정이 필수가 된다
// (C가문 only_prodc='Yes' 와 동일한 기존 후결자 기능을 그대로 쓴다 — 결재 경로는 바뀌지 않는다).
export const OTHER_PURPOSE_LAB = '연구소 제품';

// '기타 목적 > Overlay 변경': 이것 **하나만** 선택된 의뢰서는 일반 결재 경로에서 J 단계가 빠진다
// (backend RequestDocument.OTHER_PURPOSE_OVERLAY / skip_j_stage 와 동일 값·기준).
export const OTHER_PURPOSE_OVERLAY = 'Overlay 변경';

// MAP 삭제 전용 map_type 값. 한글 그대로 저장한다 — 다른 요청 목적 값들(신규/차용/기타 등)과
// 동일한 관례이고, 문서 제목(`MAP(${map_type})`)·상세 Chip 처럼 i18n 을 거치지 않고 원문이 그대로
// 노출되는 지점에서도 "삭제" 로 보이게 하기 위함이다.
// ⚠️ 과거 '완성된 MAP 변경' 기능이 쓰다 2026-08-05 에 삭제된 'EDIT' 는 재사용하지 않는다
//    (그때 저장된 레거시 문서와 구분되지 않는다).
// (2026-08) 짝이었던 '수정'(MAP_TYPE_EDIT_REQ)은 요청 목적에서 '수정'이 빠지면서 함께 삭제됐다.
export const MAP_TYPE_DELETE_REQ = '삭제';

/** map_type 이 MAP 삭제 전용 값인가 */
export const isMapDeleteEditType = (mapType?: string): boolean =>
  mapType === MAP_TYPE_DELETE_REQ;

// MAP 목적(map_type) 값 — StepMap 버튼 값이자 그대로 저장되는 값이다.
export const MAP_TYPE_CLONE = 'CLONE';
export const MAP_TYPE_EXISTING = 'EXISTING';

/** 이미 등록된 MAP 을 그대로 쓰는 유형인가(차용·기등록).
 *
 * 이 유형은 StepMap 의 지도편차·예외구역·X표시·Map Option 입력칸이 전부 잠겨
 * 사용자가 값을 바꿀 수 없다. 따라서 그 칸들의 **기본값도 NEW 와 달라야 한다**
 * — 잠긴 채로 '변경 있음'·300 이 저장되면 "안 건드렸는데 바꾼 것"이 되기 때문이다.
 * 아래 regionMapChangeDefault·eaDefaultValue 가 그 규칙의 단일 출처다.
 */
export const isMapRegisteredType = (mapType?: string): boolean =>
  mapType === MAP_TYPE_CLONE || mapType === MAP_TYPE_EXISTING;

// 지도 편차(map_change / map_change_top / map_change_bottom) 선택값.
export const MAP_NO_CHANGE = '변경 없음';
export const MAP_HAS_CHANGE = '변경 있음';

/** 리전별(C가문 상/하판) 지도 편차 기본값 — CLONE/EXISTING 은 잠기므로 '변경 없음'이다. */
export const regionMapChangeDefault = (mapType?: string): string =>
  isMapRegisteredType(mapType) ? MAP_NO_CHANGE : MAP_HAS_CHANGE;

// 예외 구역(ea_change) 선택값. detail.ea_change 에 이 한글 문자열이 그대로 저장된다.
export const EA_NO_CHANGE = '변경 없음';
export const EA_HAS_CHANGE = '변경 있음';

// 예외 구역 기본값 — C가문(only_prodc='Yes')이면 500, 아니면 300 (2026-08).
// '변경 없음'이면 이 값이 ea_value 에 그대로 채워지고 입력칸은 잠긴다.
// 바깥에서는 항상 eaDefaultValue() 로만 읽는다(map_type 조건이 함수 안에 있어야 하므로 export 하지 않는다).
// ⚠️ 백엔드 RequestDocument.EA_DEFAULT_NORMAL / EA_DEFAULT_PRODC 와 같은 값이어야 한다.
const EA_DEFAULT_NORMAL = '300';
const EA_DEFAULT_PRODC = '500';

/** only_prodc·map_type 에 맞는 예외 구역 기본값.
 *  CLONE/EXISTING 은 입력칸이 잠겨 값을 넣을 수 없으므로 빈 값이다(300/500 을 채우지 않는다). */
export const eaDefaultValue = (onlyProdc?: string, mapType?: string): string => {
  if (isMapRegisteredType(mapType)) return '';
  return onlyProdc === 'Yes' ? EA_DEFAULT_PRODC : EA_DEFAULT_NORMAL;
};

// '기타 목적 > ADI CD 변경': 특정 제품 ADI CD 스텝 개수 증감/전체삭제 요청.
export const OTHER_PURPOSE_ADI_CD = 'ADI CD 변경';
// 초기 빈 템플릿 행 수
export const ADI_CD_TEMPLATE_ROWS = 5;
// 붙여넣기 허용 최대 행 수(초과 시 거부)
export const ADI_CD_MAX_ROWS = 500;
// 헤더 탐색 시 위에서부터 볼 최대 행 수(제목 행·빈 행이 섞여 있을 수 있어 첫 행만 보지 않는다)
export const ADI_CD_HEADER_SCAN_ROWS = 5;
// 헤더 라벨 — 의뢰자가 엑셀 원본과 대조해야 하므로 번역하지 않는다.
export const ADI_CD_STEP_ID_LABEL = 'STEP_ID';
export const ADI_CD_STEP_DESC_LABEL = 'STEP_DESC';

export { ST_CELL_COLOR } from '../../utils/stCellColor';

// ===== Validation System 대상 판정 =====
/** 판정 키워드 — J-layer 행의 pp 값에 포함되면 그 행은 대상 근거가 된다(대소문자 무관) */
export const VALIDATION_KEYWORD = 'plel';
/**
 * detail.validation_system 에 저장되는 값.
 * 판정 키워드가 아예 없는 문서는 판정 자체가 성립하지 않으므로 VS_NA('해당없음')이며,
 * 이때는 E(MASK) 단계도 결재 경로에 포함되지 않는다(백엔드 has_ppid_plel 과 동일 기준).
 */
export const VS_TARGET = 'YES';
export const VS_NONTARGET = 'NO';
export const VS_NA = 'NA';
/** 판정 키워드는 있는데 상신자가 아직 대상/비대상을 고르지 않은 상태.
 *  (2026-08) 예전에는 키워드가 있으면 VS_TARGET 이 자동 선택됐지만, 판정 주체가 상신자 하나이므로
 *  자동 선택을 없애고 이 상태로 시작한다 — validate(3) 이 O-layer 단계 이동을 막는다. */
export const VS_UNSELECTED = '';
/** 판정 키워드를 포함한 pp 셀 배경색 */
export const VALIDATION_CELL_COLOR = '#fff9c4';

// 엑셀식 붙여넣기용 편집 가능 컬럼 순서(표 표시 순서와 동일). No/체크박스/Update(읽기전용) 제외.
export const JAYER_EDITABLE_COLS = ['process_id', 'sp', 'sd', 'layerid', 'pp', 'st', 'new_or_copy', 'product_name', 'step', 'item_id'] as const;
export const OAYER_EDITABLE_COLS = ['process_id', 'sp', 'sd', 'layerid', 'pp', 'st', 'new_or_copy', 'product_name', 'step'] as const;
// 자동채움/병합으로 "불러온" 행에서 읽기전용으로 잠그는 컬럼(수동 추가 행은 편집 허용)
export const LOADED_LOCK_COLS = ['process_id', 'sp', 'sd', 'layerid', 'pp'] as const;
/**
 * bb 행이 J-ayer 행에서 복사해 가는 컬럼(`handleApplyMappings`/`buildAutoFillRows` 기준).
 * bb 표의 나머지 값은 외부 데이터에서 오므로, 이 컬럼들이 바뀔 때만 매핑을 다시 잡을 이유가 있다.
 * 불러온 행에서는 셋 다 `LOADED_LOCK_COLS` 로 잠겨 있어 사실상 수동 추가 행에서만 바뀐다.
 */
export const BB_MIRRORED_COLS = ['process_id', 'sp', 'sd'] as const;
export const isBbMirroredCol = (col: string): boolean =>
  (BB_MIRRORED_COLS as readonly string[]).includes(col);
// J/O-layer 표의 col_new_or_copy · col_st 저장값(그대로 DB 에 들어간다).
export const NOC_NEW = '신규';
export const NOC_BORROW = '차용';
export const NOC_REGISTERED = '기등록';
export const NOC_LAYER_DELETE = 'layer삭제';
export const ST_O = 'O';
/** st 의 또 다른 'O 계열' 값 — 표의 선택지는 'O' / 'O (D)' / 'X' 셋뿐이다. */
export const ST_O_D = 'O (D)';
export const ST_X = 'X';

/** st 가 'O 계열'('O' 또는 'O (D)')인가 — Backbone 조합 영역 필수 판정의 근거. */
export const isStO = (st?: string): boolean => {
  const v = (st ?? '').trim();
  return v === ST_O || v === ST_O_D;
};

// new_or_copy가 이 값이면 J↔O 동기화(송신·수신)에서 제외하고 bb 원본 데이터 목록에서도 숨긴다.
export const isNocSpecial = (noc?: string): boolean => noc === NOC_REGISTERED || noc === NOC_LAYER_DELETE;

// ===== Shared Types =====
export type CRegion = 'top' | 'middle' | 'bottom';
/** C가문 '제품 해당 위치'. '' = 미선택(게이트), 'only_*' = 그 리전 하나만 사용. */
export type ProdcScope = DetailFormState['prodc_scope'];
/** 라디오 표시 순서 — 기존 3개 뒤에 ONLY 2개를 이어붙인다. */
export const PRODC_SCOPE_OPTIONS: {
  value: Exclude<ProdcScope, ''>;
  labelKey: 'prodc_top' | 'prodc_middle' | 'prodc_bottom' | 'prodc_only_top' | 'prodc_only_bottom';
}[] = [
  { value: 'top', labelKey: 'prodc_top' },
  { value: 'middle', labelKey: 'prodc_middle' },
  { value: 'bottom', labelKey: 'prodc_bottom' },
  { value: 'only_top', labelKey: 'prodc_only_top' },
  { value: 'only_bottom', labelKey: 'prodc_only_bottom' },
];

/**
 * prodc_scope 가 없는 옛 문서를 저장값으로 역추론한다(편집 로드 백필).
 * 북·남 둘 다 있으면 'top'(북/중/남 셋은 잠금·필수 규칙이 동일해 어느 값이든 동작이 같다),
 * 한쪽만 있으면 그쪽 ONLY 스코프로 본다.
 */
export function inferProdcScope(d: Partial<DetailFormState>): ProdcScope {
  const hasTop = !!(d.prodc_top_line || d.prodc_top_process || d.prodc_top_product);
  const hasBottom = !!(d.prodc_bottom_line || d.prodc_bottom_process || d.prodc_bottom_product);
  if (hasTop && hasBottom) return 'top';
  if (hasTop) return 'only_top';
  if (hasBottom) return 'only_bottom';
  return '';
}

// ===== Row Factories =====
export const genId = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`;

// Backbone 조합 영역 한 항목(bb_entries). React key·매핑 출처 식별을 위해 항목마다 고유 id를 둔다.
export const makeBbEntry = (): { id: string; location: string; product: string; process_id: string } => ({
  id: genId(),
  location: '',
  product: '',
  process_id: '',
});

export const makeRow = (): FlowChartRow => ({
  id: genId(),
  location: '',
  product_name: '',
  process_id: '',
  step_from: '',
  step_to: '',
});

export const makeJayerRow = (): JayerRow => ({
  id: genId(),
  updated: '',
  sortOrder: Date.now(),
  disabled: false,
  manuallyDisabled: false,
  process_id: '',
  sp: '',
  sd: '',
  pp: '',
  layerid: '',
  st: '',
  new_or_copy: '',
  product_name: '',
  step: '',
  item_id: '',
});

export const makeOayerRow = (): OayerRow => ({
  id: genId(),
  updated: '',
  sortOrder: Date.now(),
  disabled: false,
  manuallyDisabled: false,
  process_id: '',
  sp: '',
  sd: '',
  pp: '',
  layerid: '',
  st: '',
  new_or_copy: '',
  product_name: '',
  step: '',
});

export const makeBbRow = (): BbTableRow => ({
  id: genId(),
  sortOrder: Date.now(),
  disabled: false,
  process_id: '',
  ss: '',
  sd: '',
  bb_process_id: '',
  bb_name: '',
  bb_layer: '',
  bb_ss: '',
  bb_step: '',
  remark: '',
});

export const makeAdiCdStep = (): AdiCdStep => ({
  id: genId(),
  step_id: '',
  step_desc: '',
  unregistered: false,
});

// ===== Initial States =====
export const INITIAL_DETAIL: DetailFormState = {
  request_purpose: '',
  line: '',
  process_selection: '',
  partid_selection: '',
  customer_name: '',
  customer_requirement: '',
  other_purpose: [],
  source_line: '',
  source_partid: '',
  change_purpose_note: '',
  flow_chart: [makeRow()],
  process_id: '',
  map_type: '',
  map_change: MAP_NO_CHANGE,
  map_value_x: '',
  map_value_y: '',
  map_reason: '',
  // MAP 삭제 전용 이유(RichTextEditor 의 HTML). 수정↔삭제 전환 시에도 값은 유지되고 라벨만 바뀐다.
  // ⚠️ C가문 지도편차 사유인 위 map_reason 과는 완전히 다른 필드다.
  map_change_reason: '',
  // 리전별 지도 편차·예외 구역 기본값은 map_type 에 따라 달라진다(regionMapChangeDefault/eaDefaultValue).
  // 여기 초기값은 map_type 이 아직 비어 있는(=NEW 계열) 상태의 값이다 —
  // CLONE/EXISTING 을 고르는 순간 각 핸들러가 위 함수로 다시 계산해 넣는다.
  map_change_top: regionMapChangeDefault(),
  map_value_x_top: '',
  map_value_y_top: '',
  map_change_bottom: regionMapChangeDefault(),
  map_value_x_bottom: '',
  map_value_y_bottom: '',
  ea_change: EA_NO_CHANGE,
  ea_value: eaDefaultValue(),
  bb_zone: '존재',
  bb_entries: [makeBbEntry()],
  only_prodc: 'No',
  prodc_scope: '',
  prodc_top_line: '',
  prodc_top_process: '',
  prodc_top_product: '',
  prodc_middle_use: '',
  prodc_middle_line: '',
  prodc_middle_process: '',
  prodc_middle_product: '',
  prodc_bottom_line: '',
  prodc_bottom_process: '',
  prodc_bottom_product: '',
  mshot_change: '없음',
  mshot_image_copy: '',
  mshot_image_copy_top: '',
  mshot_image_copy_bottom: '',
  photo_backside: '미적용',
  eds_backside: '미적용',
  inter: 'NO',
  inter_xs: '미적용',
  inter_ys: '미적용',
  in_apply: '',
  inter_select: '',
  tsv: '미적용',
  rf: '미적용',
  fullchip: '미적용',
  split: '미적용',
  st: '미적용',
  ecc: '미적용',
  labelsideshot: '미적용',
  hpkglabelheight: '미적용',
  final_yn: '',
  final_entries: [],
  partial_shot: '',
  tbvtlv_thickness: '',
  tbvtlv_entries: [],
  notifiers: [],
  validation_system: VS_UNSELECTED,
  merge_ref_doc_id: null,
  merge_ref_doc_label: '',
  merge_ref_mode: 'ref',
  merge_applied: false,
  merge_pairs: [],
  merge_unmatched_before: [],
  merge_unmatched_after: [],
  adi_cd_before: [],
  adi_cd_after: [],
  adi_cd_delete_all: false,
};

export const INITIAL_FORM: CreateDocumentInput = {
  title: '',
  requester_name: '',
  requester_email: '',
  requester_department: '',
  product_name: '',
  production_date: null,
  reference_materials: '',
  additional_notes: '',
};

export const DETAIL_REQUIRED: (keyof DetailFormState)[] = [
  'request_purpose',
  'line',
  'process_selection',
  'partid_selection',
  'process_id',
];

// ===== 전체 가이드(투어) 샘플 시드 =====
// /request?embed=tour 진입 시, 위저드 각 단계를 "값이 채워진" 상태로 보여주기 위한 샘플 데이터.
export const makeTourDetail = (): DetailFormState => ({
  ...INITIAL_DETAIL,
  request_purpose: '신규',
  line: '라인1',
  process_selection: 'RECIPE_A',
  partid_selection: 'PART_1000',
  process_id: 'PROC_X1',
  customer_name: '샘플 고객사',
  customer_requirement: '신규 라인 제품 소개 지도 제작 요청',
  map_type: 'NEW',
  // BB 자동채움/매핑 데모용 — 외부 데이터 탭 2개와 1:1로 대응한다.
  bb_entries: [
    { ...makeBbEntry(), product: 'BB제품1', process_id: 'BB_R1' },
    { ...makeBbEntry(), product: 'BB제품2', process_id: 'BB_R2' },
  ],
});

// J-ayer 행의 Layer 값 — BB 자동채움이 실제로 매칭되도록 외부 데이터 layerid와 맞춘다.
export const TOUR_JAYER_LAYERS = ['10', '20', '30', '40', '50'];

// Validation System 시연용 — 판정 키워드(plel)를 가진 행이 있어야 '해당없음'으로 잠기지 않고
// 상신자가 대상/비대상을 직접 고르는 화면(2026-08 필수 선택)을 보여줄 수 있다.
export const TOUR_JAYER_VS_ROW_INDEX = 2;

export const makeTourJayerRows = (): JayerRow[] =>
  TOUR_JAYER_LAYERS.map((layer, i) => ({
    ...makeJayerRow(),
    sortOrder: i,
    process_id: 'PROC_X1',
    sp: `SP0${i + 1}`,
    sd: `SD0${i + 1}`,
    pp: i === TOUR_JAYER_VS_ROW_INDEX ? `PP0${i + 1}_${VALIDATION_KEYWORD}` : `PP0${i + 1}`,
    layerid: layer,
    st: 'O',
    new_or_copy: '신규',
    product_name: '',
    step: '',
    item_id: '',
  }));

export const makeTourOayerRows = (): OayerRow[] => [
  { ...makeOayerRow(), sortOrder: 0, process_id: 'PROC_X1', sp: 'SP01', sd: 'SD01', pp: 'PP01', layerid: 'L01', st: 'ST1', new_or_copy: '신규', product_name: '샘플제품A', step: '10' },
  { ...makeOayerRow(), sortOrder: 1, process_id: 'PROC_X1', sp: 'SP02', sd: 'SD02', pp: 'PP02', layerid: 'L02', st: 'ST1', new_or_copy: '신규', product_name: '샘플제품A', step: '20' },
  // TBV/TLV는 O-ayer에 TBV/TLV 항목이 있어야 '정보' 탭에 노출된다 — 데모용 시드 1행.
  { ...makeOayerRow(), sortOrder: 2, process_id: 'PROC_X1', sp: 'SP03', sd: 'TBV', pp: 'PP03', layerid: 'L03', st: 'ST1', new_or_copy: '신규', product_name: '샘플제품A', step: '30' },
];

export const makeTourBbRows = (): BbTableRow[] => [
  { ...makeBbRow(), process_id: 'PROC_X1', ss: 'SP01', sd: 'SD01', bb_process_id: 'BB_R1', bb_name: 'BB제품1', bb_layer: '10', bb_ss: '110', bb_step: 'BB제품1 STEP', remark: '' },
  { ...makeBbRow(), process_id: 'PROC_X1', ss: 'SP02', sd: 'SD02', bb_process_id: 'BB_R1', bb_name: 'BB제품1', bb_layer: '20', bb_ss: '120', bb_step: 'BB제품1 STEP', remark: '' },
];

// BB 자동채움·매핑 데모용 외부 데이터 (PhotoStepOption[][]) — 탭은 bb_entries와 1:1 대응.
// 탭1(BB제품1)은 Layer 10/20/30, 탭2(BB제품2)는 Layer 40/50을 담당한다.
export const makeTourBbExternalData = () => [
  [
    { processid: 'BB_R1', stepseq: '110', descript: 'BB제품1 STEP', layerid: '10' },
    { processid: 'BB_R1', stepseq: '120', descript: 'BB제품1 STEP', layerid: '20' },
    { processid: 'BB_R1', stepseq: '130', descript: 'BB제품1 STEP', layerid: '30' },
  ],
  [
    { processid: 'BB_R2', stepseq: '240', descript: 'BB제품2 STEP', layerid: '40' },
    { processid: 'BB_R2', stepseq: '250', descript: 'BB제품2 STEP', layerid: '50' },
  ],
];

// J-ayer 데모에서 채워 넣을 샘플 값
// ADI CD 변경 시연용 — 변경전 1행을 '미등록'(새로 생기는 STEP)으로 둬 행 단위 미등록 표기를 보여준다.
export const makeTourAdiCdBefore = (): AdiCdStep[] => [
  { ...makeAdiCdStep(), step_id: 'STEP_1000', step_desc: 'ADI CD 변경전 STEP' },
  { ...makeAdiCdStep(), step_id: '', step_desc: '', unregistered: true },
];

export const makeTourAdiCdAfter = (): AdiCdStep[] => [
  { ...makeAdiCdStep(), step_id: 'STEP_1000', step_desc: 'ADI CD 변경후 STEP' },
  { ...makeAdiCdStep(), step_id: 'STEP_2000', step_desc: '신규 추가 STEP' },
];

// 참조 요청서 Merge 블록을 여는 기타 목적 — 시연에서만 쓰는 대표값.
export const TOUR_MERGE_PURPOSE = 'Layer 추가/삭제';

export const TOUR_JAYER_PRODUCT = '샘플제품A';
export const TOUR_JAYER_STEPS = ['10', '20', '30', '40', '50'];
export const TOUR_JAYER_ITEMS = ['ITEM_1', 'ITEM_2', 'ITEM_3', 'ITEM_4', 'ITEM_5'];
