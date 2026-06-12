// ===== Auth / Role Types =====

// 역할 타입 (null 제외 - 기본)
export type UserRole = 'PL' | 'TE_R' | 'TE_P' | 'TE_J' | 'TE_O' | 'TE_E' | 'MASTER' | 'NONE';

// null 을 포함한 역할 타입
export type UserRoleWithNull = UserRole | null | 'NONE';

export interface MockUser {
  id: number;
  username: string;
  name: string;
  role: UserRoleWithNull;
  department: string;
  email: string;
}

export interface UserInfo {
  id: number;
  username: string;
  name: string;
  role: UserRoleWithNull;
  department: string;
  email: string;
}


export interface Line {
  id: number;
  name: string;
  order: number;
}


export type Status =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected';

export type VocStatus = 'checking' | 'completed' | 'rejected';

export type VocCategory = 'inquiry' | 'error_report' | 'feature_request' | 'task_request';

export type AgentType = 'PL' | 'R' | 'P' | 'J' | 'O' | 'E';
export type StepAction = 'pending' | 'approved' | 'rejected';

// 역할 → 담당자 매핑 (null 제외)
export const ROLE_TO_AGENT: Partial<Record<UserRole, AgentType>> = {
  TE_R: 'R',
  TE_P: 'P',
  TE_J: 'J',
  TE_O: 'O',
  TE_E: 'E',
};

export interface ApprovalStepFrontend {
  id: number;
  agent: AgentType;
  action: StepAction;
  acted_at: string | null;
  comment?: string;
  is_parallel?: boolean;  // J, O 병렬 표시용
  assignee_loginid?: string; // 담당자 loginid
  assignee_name?: string;    // 담당자 이름
  round: number;             // 상신 회차
  created_at?: string | null; // 단계 생성일시 (R 단계의 경우 해당 회차 상신 시각)
  due_date?: string | null;   // 완료 기한 (YYYY-MM-DD)
}

// ===== Domain Models =====

export interface RequestDocument {
  id: number;
  title: string;
  requester_name: string;
  requester_email: string;
  requester_department: string;
  product_name: string;
  reference_materials: string;
  additional_notes: string;
  status: Status;
  production_date: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  designated_pl_loginid?: string | null;
  designated_pl_name?: string;
  approval_steps?: ApprovalStepFrontend[];
}

export type CreateDocumentInput = Omit<
  RequestDocument,
  'id' | 'status' | 'created_at' | 'updated_at' | 'submitted_at' | 'approval_steps'
>;

export type UpdateDocumentInput = Partial<CreateDocumentInput>;

export type VocPage = 'request' | 'approval' | 'history' | 'other';

export interface VocComment {
  id: number;
  author_name: string;
  author_role: UserRole;
  is_submitter: boolean;
  content: string;
  is_reject_reason: boolean;
  created_at: string;
}

export interface VOC {
  id: number;
  title: string;
  category: VocCategory;
  submitter_name: string;
  submitter_email: string;
  submitter_user_id?: number;
  content: string;
  page?: VocPage;
  comments: VocComment[];
  status: VocStatus;
  created_at: string;
}

export type CreateVocInput = Omit<VOC, 'id' | 'comments' | 'status' | 'created_at'>;

export type AddVocCommentInput = {
  content: string;
  is_reject_reason?: boolean;
};

export interface Stats {
  total: number;
  by_status: Record<string, number>;
}

// ===== Detail Form Types =====

export interface FlowChartRow {
  id: string;
  location: string;
  product_name: string;
  process_id: string;
  step_from: string;
  step_to: string;
}

export interface FilterSet {
  id: string;
  label: string;
  words: { sp: string[]; sd: string[]; pp: string[] };
}

export interface JayerRow {
  id: string;
  updated: string;      // 'YYYYMMDD HH:MM' 형식
  sortOrder: number;
  disabled: boolean;
  manuallyDisabled: boolean;
  process_id: string;
  sp: string;
  sd: string;
  pp: string;
  layerid: string;      // Layer 컬럼
  st: string;           // 'O' | 'X' | ''
  new_or_copy: string;  // '신규' | '복사' | ''
  product_name: string;
  step: string;
  item_id: string;
}

export interface OayerRow {
  id: string;
  updated: string;      // 'YYYYMMDD HH:MM' 형식
  sortOrder: number;
  disabled: boolean;
  manuallyDisabled: boolean;
  process_id: string;
  sp: string;
  sd: string;
  pp: string;
  layerid: string;      // Layer 컬럼 (Step2와 동일)
  st: string;
  new_or_copy: string;
  product_name: string;
  step: string;
}

export interface BbTableRow {
  id: string;
  sourceJayerRowId?: string;  // 어떤 J-ayer 행에서 왔는지 추적
  sortOrder: number;
  disabled: boolean;
  process_id: string;
  ss: string;
  sd: string;
  bb_process_id: string;
  bb_name: string;
  bb_step: string;
  bb_ss: string;
  remark: string;
}

export interface DetailFormState {
  // 항상 표시
  request_purpose: string;
  line: string;
  process_selection: string;
  partid_selection: string;
  customer_name: string;
  customer_requirement: string;

  // 복사 선택 시
  other_purpose: string;
  source_line: string;
  source_partid: string;
  change_purpose_note: string;
  flow_chart: FlowChartRow[];

  // 제품 이름 선택 시
  process_id: string;

  map_type: string;
  map_change: string;
  map_value_x: string;
  map_value_y: string;
  map_reason: string;

  // Exclusive Area
  ea_change: string;
  ea_value: string;

  // Backbone
  bb_zone: string;
  bb_entries: Array<{ location: string; product: string; process_id: string }>;

  only_prodc: string;
  prodc_top_line: string;
  prodc_top_process: string;
  prodc_top_product: string;
  prodc_middle_use: string;
  prodc_middle_line: string;
  prodc_middle_process: string;
  prodc_middle_product: string;
  prodc_bottom_line: string;
  prodc_bottom_process: string;
  prodc_bottom_product: string;

  map_change_top: string;
  map_value_x_top: string;
  map_value_y_top: string;
  map_change_bottom: string;
  map_value_x_bottom: string;
  map_value_y_bottom: string;

  mshot_change: string;
  mshot_image_copy: string;       // C가문 No일 때 단일 이미지
  mshot_image_copy_top: string;   // C가문 Yes일 때 북쪽 이미지
  mshot_image_copy_bottom: string; // C가문 Yes일 때 남쪽 이미지

  photo_backside: string;
  eds_backside: string;
  inter: string;
  tsv: string;
  rf: string;
  fullchip: string;
  split: string;
  st: string;
  ecc: string;
  labelsideshot: string;

  rev_yn: string;
  rev_entries: Array<{ layers: string[]; gds: string }>;

  // O-ayer 정보 탭
  partial_shot: string;
  tbvtlv_thickness: string;
  tbvtlv_entries: Array<{ sds: string[]; note: string }>;
}

// ===== Change History =====

export interface HistorySnapshot {
  timestamp: string;   // ISO 8601, 재상신 직전 시각
  detail: DetailFormState;
  jayerRows: JayerRow[];
  oayerRows: OayerRow[];
  bbRows: BbTableRow[];
}

// ===== API Response Wrappers =====
// Pages consume responses as r.data or r.data.results

export interface ApiResponse<T> {
  data: T;
}

export interface ApiListResponse<T> {
  data: { results: T[]; count: number } | T[];
}

// ===== Admin Notice =====

export type NoticeTemplate = 'notice' | 'release_note';
export type ReleaseCategory = 'new' | 'updated' | 'bugfix';

export interface ReleaseItem {
  category: ReleaseCategory;
  content: string;
}

export interface AdminNotice {
  id: number;
  template: NoticeTemplate;
  date: string;          // 'YYYY-MM-DD'
  title: string;
  content: string;       // Notice 타입 전용
  items: ReleaseItem[];  // Release Note 타입 전용
  created_at: string;
  updated_at: string;
}

export type CreateNoticeInput = Omit<AdminNotice, 'id' | 'created_at' | 'updated_at'>;
export type UpdateNoticeInput = Partial<CreateNoticeInput>;

// ===== User Management =====

export interface UserWithRole {
  id: number;
  loginid: string;
  name: string;
  deptname: string;
  role: UserRole;
  mail: string;
}

export interface CreateUserInput {
  loginid: string;
  role: UserRole;
}

export interface AssignRoleInput {
  userId: number;
  role: UserRole;
}

// ===== User Groups =====

export interface UserGroupMember {
  id: number;
  loginid: string;
  name: string;
  mail: string;
  deptname: string;
  role: UserRole;
}

export interface UserGroup {
  id: number;
  name: string;
  creator_loginid: string;
  members: UserGroupMember[];
  created_at: string;
}

export interface AvailableGroupMember {
  id: number;
  loginid: string;
  name: string;
  mail: string;
  deptname: string;
}

export interface UserForAssignment {
  id: number;
  username: string;       // DB loginid
  display_name: string;   // DB username (표시 이름)
  department: string;     // DB deptname
  email: string;          // DB mail
  current_role?: UserRole; // MASTER 조회 시에만 포함
}


export interface StepInfo {
  line: string;
  process: string;
  processid: string;
  stepseq: string;
  descript: string;
  recipeid: string;
  layerid: string;  
  updated: string;  // 'YYYYMMDDHHMMSS' 형식
}

// ===== Guide =====

export type GuideType = 'feature' | 'info';

// 기능 가이드의 feature_key 목록 (Step별 고정)
export type GuideFeatureKey =
  | 'step1_line_process' | 'step1_request_purpose' | 'step1_other_purpose'
  | 'step1_flow_chart' | 'step1_bb_entry' | 'step1_customer_vendor'
  | 'step2_map_type' | 'step2_source_location' | 'step2_map_deviation'
  | 'step2_exception_zone' | 'step2_cfamily' | 'step2_rev'
  | 'step2_xmark' | 'step2_map_options'
  | 'step3_jayer_table' | 'step3_jayer_filter'
  | 'step4_oayer_table' | 'step4_partial_shot' | 'step4_tbvtlv'
  | 'step5_bb_autofill' | 'step5_bb_mapping' | 'step5_bb_table';

export interface Guide {
  id: number;
  guide_type: GuideType;
  feature_key: GuideFeatureKey | null;
  title: string;
  content: string;
  author_name: string;
  author_role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface CreateGuideInput {
  guide_type: GuideType;
  feature_key?: GuideFeatureKey | null;
  title: string;
  content: string;
}

// Step별 기능 목록 상수
export const GUIDE_STEP_FEATURES: Record<number, { key: GuideFeatureKey; labelKey: string }[]> = {
  1: [
    { key: 'step1_line_process',    labelKey: 'guide.feat.step1_line_process' },
    { key: 'step1_request_purpose', labelKey: 'guide.feat.step1_request_purpose' },
    { key: 'step1_other_purpose',   labelKey: 'guide.feat.step1_other_purpose' },
    { key: 'step1_flow_chart',      labelKey: 'guide.feat.step1_flow_chart' },
    { key: 'step1_bb_entry',        labelKey: 'guide.feat.step1_bb_entry' },
    { key: 'step1_customer_vendor', labelKey: 'guide.feat.step1_customer_vendor' },
  ],
  2: [
    { key: 'step2_map_type',        labelKey: 'guide.feat.step2_map_type' },
    { key: 'step2_source_location', labelKey: 'guide.feat.step2_source_location' },
    { key: 'step2_map_deviation',   labelKey: 'guide.feat.step2_map_deviation' },
    { key: 'step2_exception_zone',  labelKey: 'guide.feat.step2_exception_zone' },
    { key: 'step2_cfamily',         labelKey: 'guide.feat.step2_cfamily' },
    { key: 'step2_rev',             labelKey: 'guide.feat.step2_rev' },
    { key: 'step2_xmark',           labelKey: 'guide.feat.step2_xmark' },
    { key: 'step2_map_options',     labelKey: 'guide.feat.step2_map_options' },
  ],
  3: [
    { key: 'step3_jayer_table',  labelKey: 'guide.feat.step3_jayer_table' },
    { key: 'step3_jayer_filter', labelKey: 'guide.feat.step3_jayer_filter' },
  ],
  4: [
    { key: 'step4_oayer_table',   labelKey: 'guide.feat.step4_oayer_table' },
    { key: 'step4_partial_shot',  labelKey: 'guide.feat.step4_partial_shot' },
    { key: 'step4_tbvtlv',        labelKey: 'guide.feat.step4_tbvtlv' },
  ],
  5: [
    { key: 'step5_bb_autofill', labelKey: 'guide.feat.step5_bb_autofill' },
    { key: 'step5_bb_mapping',  labelKey: 'guide.feat.step5_bb_mapping' },
    { key: 'step5_bb_table',    labelKey: 'guide.feat.step5_bb_table' },
  ],
};

export interface ExternalBbDataItem {
  id: string;
  bb_process_id: string;
  bb_name: string;
  bb_step: string;
  bb_ss: string;
  layerid?: string;  
}


export interface PhotoStepOption {
  processid: string;
  stepseq: string;
  descript: string;
  layerid: string;  
}


export interface BbAutoFillRange {
  id: string;
  layerFrom: string;      // 시작 Layer
  layerTo: string;        // 종료 Layer
  productId: string;      // 선택된 PART ID
}
