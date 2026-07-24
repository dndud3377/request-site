import {
  CreateDocumentInput,
  DetailFormState,
  FlowChartRow,
  JayerRow,
  OayerRow,
  BbTableRow,
} from '../../types';

// ===== Option Constants =====
export const OPTION_REQUEST_PURPOSE = ['신규', '차용', '신규+차용', 'Only MAP', '기타'] as const;
export const OPTION_LINE = ['라인1', '라인2', '라인3', '라인4', '라인5'] as const;
export const OPTION_OTHER_PURPOSE = ['Layer 추가/삭제', 'STEPSEQ 변경', '공법 추가/변경', 'Overlay 변경', 'ADI CD 변경', 'FirstA 변경', '완성된 MAP 변경'] as const;

// '완성된 MAP 변경' 기타 목적: 결재완료 요청서의 MAP 정보만 불러와 수정하는 단독 전용 항목.
export const OTHER_PURPOSE_MAP_CHANGE = '완성된 MAP 변경';

// '완성된 MAP 변경' 프리필 시 참조 문서 detail 에서 복사할 MAP 관련 키.
// 이 키들만 현재 detail 위에 병합하고(기본정보·표는 유지·비움), 변경이력 diff 비교 기준이 된다.
export const MAP_DETAIL_KEYS: (keyof DetailFormState)[] = [
  'map_type', 'map_change', 'map_value_x', 'map_value_y', 'map_reason',
  'map_change_top', 'map_value_x_top', 'map_value_y_top',
  'map_change_bottom', 'map_value_x_bottom', 'map_value_y_bottom',
  'ea_change', 'ea_value',
  'only_prodc',
  'prodc_top_line', 'prodc_top_process', 'prodc_top_product',
  'prodc_middle_use', 'prodc_middle_line', 'prodc_middle_process', 'prodc_middle_product',
  'prodc_bottom_line', 'prodc_bottom_process', 'prodc_bottom_product',
  'mshot_change', 'mshot_image_copy', 'mshot_image_copy_top', 'mshot_image_copy_bottom',
  'photo_backside', 'eds_backside', 'inter', 'inter_xs', 'inter_ys',
  'tsv', 'rf', 'fullchip', 'split', 'st', 'ecc', 'labelsideshot', 'hpkglabelheight',
  'rev_yn', 'rev_entries', 'source_line', 'source_partid',
];

export { ST_CELL_COLOR } from '../../utils/stCellColor';

// 엑셀식 붙여넣기용 편집 가능 컬럼 순서(표 표시 순서와 동일). No/체크박스/Update(읽기전용) 제외.
export const JAYER_EDITABLE_COLS = ['process_id', 'sp', 'sd', 'layerid', 'pp', 'st', 'new_or_copy', 'product_name', 'step', 'item_id'] as const;
export const OAYER_EDITABLE_COLS = ['process_id', 'sp', 'sd', 'layerid', 'pp', 'st', 'new_or_copy', 'product_name', 'step'] as const;
// 자동채움/병합으로 "불러온" 행에서 읽기전용으로 잠그는 컬럼(수동 추가 행은 편집 허용)
export const LOADED_LOCK_COLS = ['process_id', 'sp', 'sd', 'layerid', 'pp'] as const;
// new_or_copy가 이 값이면 J↔O 동기화(송신·수신)에서 제외하고 bb 원본 데이터 목록에서도 숨긴다.
export const isNocSpecial = (noc?: string): boolean => noc === '기등록' || noc === 'layer삭제';

// ===== Shared Types =====
export type CRegion = 'top' | 'middle' | 'bottom';

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
  map_change: '변경 없음',
  map_value_x: '',
  map_value_y: '',
  map_reason: '',
  map_change_top: '변경 있음',
  map_value_x_top: '',
  map_value_y_top: '',
  map_change_bottom: '변경 있음',
  map_value_x_bottom: '',
  map_value_y_bottom: '',
  ea_change: '변경 없음',
  ea_value: '',
  bb_zone: '존재',
  bb_entries: [makeBbEntry()],
  only_prodc: 'No',
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
  tsv: '미적용',
  rf: '미적용',
  fullchip: '미적용',
  split: '미적용',
  st: '미적용',
  ecc: '미적용',
  labelsideshot: '미적용',
  hpkglabelheight: '미적용',
  rev_yn: '',
  rev_entries: [],
  partial_shot: '',
  tbvtlv_thickness: '',
  tbvtlv_entries: [],
  notifiers: [],
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

export const makeTourJayerRows = (): JayerRow[] =>
  TOUR_JAYER_LAYERS.map((layer, i) => ({
    ...makeJayerRow(),
    sortOrder: i,
    process_id: 'PROC_X1',
    sp: `SP0${i + 1}`,
    sd: `SD0${i + 1}`,
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
export const TOUR_JAYER_PRODUCT = '샘플제품A';
export const TOUR_JAYER_STEPS = ['10', '20', '30', '40', '50'];
export const TOUR_JAYER_ITEMS = ['ITEM_1', 'ITEM_2', 'ITEM_3', 'ITEM_4', 'ITEM_5'];
