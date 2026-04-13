// ===== Auth / Role Types =====

export type UserRole = 'PL' | 'TE_R' | 'TE_J' | 'TE_O' | 'TE_E' | 'MASTER';

export interface MockUser {
  id: number;
  username: string;
  password: string;
  name: string;
  role: UserRole;
  department: string;
  email: string;
}

// ===== Master Data =====

export interface Line {
  id: number;
  name: string;
  order: number;
}

// ===== Domain Enums / Literal Types =====

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

export interface ApprovalStepFrontend {
  id: number;
  agent: AgentType;
  action: StepAction;
  acted_at: string | null;
  comment?: string;
  is_parallel?: boolean;  // J, O 병렬 표시용
  assignee_id?: number;   // 담당자 user ID
  assignee_name?: string; // 담당자 이름
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

export interface VOC {
  id: number;
  title: string;
  category: VocCategory;
  submitter_name: string;
  submitter_email: string;
  submitter_user_id?: number;
  content: string;
  response: string;
  status: VocStatus;
  created_at: string;
  responded_at: string | null;
}

export type CreateVocInput = Omit<VOC, 'id' | 'response' | 'status' | 'created_at' | 'responded_at'>;

export interface Stats {
  total: number;
  by_status: Record<string, number>;
}

// ===== Detail Form Types =====

export interface FlowChartRow {
  id: string;
  location: string;
  product_name: string;
  step: string;
}

export interface JayerRow {
  id: string;
  process_id: string;
  sp: string;
  sd: string;
  pp: string;
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

  // 지도 편차
  map_change: string;
  map_value_x: string;
  map_value_y: string;
  map_reason: string;

  // 예외 구역
  ea_change: string;
  ea_value: string;

  // 분리
  split_progress: string;

  // 뼈찜
  bb_zone: string;
  bb_entries: Array<{ location: string; product: string; process_id: string }>;

  // C가문
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

  // X표시
  mshot_change: string;
  mshot_image_copy: string;

  // 20주년
  ip_status: string;
  ip_option: string;

  // T가문 / 주력 / 설탕
  tmap_apply: string;
  hplhc_change: string;
  e_lps: string;
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

// ===== big data Step Info =====

export interface StepInfo {
  processid: string;
  step: string;
  process: string;
  recipeid: string;
}

// ===== 뼈찜 외부 데이터 소스 =====

export interface ExternalBbDataItem {
  id: string;
  bb_process_id: string;
  bb_name: string;
  bb_step: string;
  bb_ss: string;
}
