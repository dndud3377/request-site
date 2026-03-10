// ===== Domain Enums / Literal Types =====

export type Status =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'revision_required';

export type VocStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type RfgStatus = 'open' | 'in_progress' | 'resolved';

export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type ProductType = 'new' | 'update' | 'add_feature' | 'change';
export type MapType = 'intro' | 'feature' | 'comparison' | 'roadmap';
export type VocCategory = 'inquiry' | 'complaint' | 'suggestion' | 'praise';

// ===== Domain Models =====

export interface RequestDocument {
  id: number;
  title: string;
  requester_name: string;
  requester_email: string;
  requester_department: string;
  requester_position: string;
  product_name: string;
  product_name_en: string;
  product_type: ProductType;
  product_version: string;
  product_description: string;
  product_description_en: string;
  map_type: MapType;
  target_audience: string;
  key_features: string;
  key_features_en: string;
  changes_from_previous: string;
  reference_materials: string;
  deadline: string;
  priority: Priority;
  additional_notes: string;
  status: Status;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}

export type CreateDocumentInput = Omit<
  RequestDocument,
  'id' | 'status' | 'created_at' | 'updated_at' | 'submitted_at'
>;

export type UpdateDocumentInput = Partial<CreateDocumentInput>;

export interface VOC {
  id: number;
  title: string;
  category: VocCategory;
  submitter_name: string;
  submitter_email: string;
  content: string;
  response: string;
  status: VocStatus;
  created_at: string;
  responded_at: string | null;
}

export type CreateVocInput = Omit<VOC, 'id' | 'response' | 'status' | 'created_at' | 'responded_at'>;

export interface RFG {
  id: number;
  title: string;
  requester_name: string;
  requester_email: string;
  product_name: string;
  description: string;
  status: RfgStatus;
  created_at: string;
}

export type CreateRfgInput = Omit<RFG, 'id' | 'status' | 'created_at'>;

export interface Stats {
  total: number;
  by_status: Record<string, number>;
}

// ===== API Response Wrappers =====
// Pages consume responses as r.data or r.data.results

export interface ApiResponse<T> {
  data: T;
}

export interface ApiListResponse<T> {
  data: { results: T[]; count: number } | T[];
}
