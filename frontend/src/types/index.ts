// ===== Auth / Role Types =====

// 역할 타입 (null 제외 - 기본)
export type UserRole = 'PL' | 'TE_R' | 'TE_J' | 'TE_O' | 'TE_E' | 'MASTER' | 'NONE';

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

export type AgentType = 'R' | 'J' | 'O' | 'E';
export type StepAction = 'pending' | 'approved' | 'rejected';

// 역할 → 담당자 매핑 (null 제외)
export const ROLE_TO_AGENT: Partial<Record<UserRole, AgentType>> = {
  TE_R: 'R',
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
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
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
  product: string;
  step: string;
}

export interface JayerRow {
  id: string;
  updated: string;      // 'YYYYMMDD HH:MM' 형식
  sortOrder: number;
  disabled: boolean;
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
  rev: string;
  drawing_version: string;
}

export interface OayerRow {
  id: string;
  updated: string;      // 'YYYYMMDD HH:MM' 형식
  sortOrder: number;
  disabled: boolean;
  process_id: string;
  sp: string;
  sd: string;
  pp: string;
  st: string;
  new_or_copy: string;
  product_name: string;
  step: string;
  tt: string;
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

  // 복사 선택 시
  other_purpose: string;
  source_line: string;
  source_partid: string;
  change_purpose_note: string;
  flow_chart: FlowChartRow[];

  // 제품 이름 선택 시
  process_id: string;

  map_change: string;
  map_value_x: string;
  map_value_y: string;
  map_reason: string;

  // Exclusive Area
  ea_change: string;
  ea_value: string;

  // split
  split_progress: string;

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

  mshot_change: string;
  mshot_image_copy: string;  // 붙여넣기 시 파일명만 저장

  ip_status: string;

  tmap_apply: string;
  hplhc_change: string;
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

export interface UserForAssignment {
  id: number;
  username: string;
  display_name: string;
  department: string;
  email: string;
}

export interface CreateUserInput {
  loginid: string;
  role: UserRole;
}

export interface AssignRoleInput {
  userId: number;
  role: UserRole;
}

export interface UserForAssignment {
  id: number;
  username: string;      // DB loginid
  display_name: string;  // DB username (표시 이름)
  department: string;    // DB deptname
  email: string;         // DB mail
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

export type GuideSection =
  | 'general'
  | 'line_combination'
  | 'jayer'
  | 'oayer'
  | 'bone'
  | 'map'
  | 'cfamily'
  | 'xmark'
  | 'separation';

export interface Guide {
  id: number;
  title: string;
  section: GuideSection;
  content: string;
  author_name: string;
  author_role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface CreateGuideInput {
  title: string;
  section: GuideSection;
  content: string;
}

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
