import {
  RequestDocument,
  VOC,
  VocComment,
  Stats,
  Line,
  CreateDocumentInput,
  UpdateDocumentInput,
  CreateVocInput,
  AgentType,
  StepInfo,
  AdminNotice,
  CreateNoticeInput,
  UpdateNoticeInput,
  Guide,
  CreateGuideInput,
} from '../types';
import { mockDocumentsAPI, mockVocAPI, mockNoticesAPI } from './mock';

// ===== Mock API 여부 확인 =====
// Vite 환경 변수: VITE_USE_MOCK=true 설정 시 Mock API 사용
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const useMockAPI = USE_MOCK;

// ===== JWT 토큰 관리 =====

const TOKEN_KEY = 'approval_system_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ===== HTTP 기본 클라이언트 =====

const BASE_URL = '/api';

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      errMsg = body.error || body.detail || JSON.stringify(body);
    } catch {
      //
    }
    throw new Error(errMsg);
  }

  // 204 No Content 처리
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function get<T>(path: string) {
  return request<T>(path);
}

function post<T>(path: string, data?: unknown) {
  return request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined });
}

function patch<T>(path: string, data?: unknown) {
  return request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined });
}

// ===== 인증 API =====

export const authAPI = {
  login: (username: string, password: string) =>
    post<{ access: string; refresh: string; user: unknown }>('/auth/login/', { username, password }),
  me: () =>
    get<{ user: unknown }>('/auth/me/'),
};

// ===== 의뢰서 API =====

const listDocuments = async (params?: Record<string, string>) => {
  if (useMockAPI && mockDocumentsAPI) return mockDocumentsAPI.list(params);
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const data = await get<{ results: RequestDocument[]; count: number } | RequestDocument[]>(
    `/documents/${qs}`
  );
  if (Array.isArray(data)) {
    return { data: { results: data, count: data.length } };
  }
  return { data };
};

const getDocument = async (id: number) => {
  if (useMockAPI && mockDocumentsAPI) return mockDocumentsAPI.get(id);
  const data = await get<RequestDocument>(`/documents/${id}/`);
  return { data };
};

const createDocument = async (input: CreateDocumentInput) => {
  if (useMockAPI && mockDocumentsAPI) return mockDocumentsAPI.create(input);
  const data = await post<RequestDocument>('/documents/', input);
  return { data };
};

const updateDocument = async (id: number, input: UpdateDocumentInput) => {
  if (useMockAPI && mockDocumentsAPI) return mockDocumentsAPI.update(id, input);
  const data = await patch<RequestDocument>(`/documents/${id}/`, input);
  return { data };
};

const submitDocument = async (id: number) => {
  if (useMockAPI && mockDocumentsAPI) return mockDocumentsAPI.submit(id);
  const data = await post<{ message: string; email_sent: boolean; document: RequestDocument }>(
    `/documents/${id}/submit/`
  );
  return { data };
};

const resubmitDocument = async (id: number) => {
  if (useMockAPI && mockDocumentsAPI) return mockDocumentsAPI.resubmit(id);
  const data = await post<{ message: string; document: RequestDocument }>(
    `/documents/${id}/resubmit/`
  );
  return { data };
};

const withdrawDocument = async (id: number) => {
  if (useMockAPI && mockDocumentsAPI) return mockDocumentsAPI.withdraw(id);
  const data = await post<{ message: string }>(`/documents/${id}/withdraw/`);
  return { data };
};

const deleteDocument = async (id: number) => {
  if (useMockAPI && mockDocumentsAPI) return mockDocumentsAPI.delete(id);
  const data = await post<{ message: string }>(`/documents/${id}/delete/`);
  return { data };
};

const approveStep = async (docId: number, agent: AgentType, comment?: string) => {
  if (useMockAPI && mockDocumentsAPI) return mockDocumentsAPI.approveStep(docId, agent, comment);
  const data = await post<{ message: string; status: string }>(
    `/documents/${docId}/approve-step/`,
    { agent, comment: comment ?? '' }
  );
  return { data };
};

const rejectStep = async (docId: number, agent: AgentType, comment?: string) => {
  if (useMockAPI && mockDocumentsAPI) return mockDocumentsAPI.rejectStep(docId, agent, comment);
  const data = await post<{ message: string; status: string }>(
    `/documents/${docId}/reject-step/`,
    { agent, comment: comment ?? '' }
  );
  return { data };
};

const assignStep = async (
  docId: number,
  agent: AgentType,
  assigneeId: number,
  assigneeName: string
) => {
  if (useMockAPI && mockDocumentsAPI) return mockDocumentsAPI.assignStep(docId, agent, assigneeId, assigneeName);
  const data = await post<{ message: string }>(`/documents/${docId}/assign-step/`, {
    agent,
    assignee_id: assigneeId,
    assignee_name: assigneeName,
  });
  return { data };
};

const documentStats = async () => {
  if (useMockAPI && mockDocumentsAPI) return mockDocumentsAPI.stats();
  const data = await get<Stats>('/documents/stats/');
  return { data };
};

export const documentsAPI = {
  list: listDocuments,
  get: getDocument,
  create: createDocument,
  update: updateDocument,
  submit: submitDocument,
  resubmit: resubmitDocument,
  withdraw: withdrawDocument,
  delete: deleteDocument,
  approveStep,
  rejectStep,
  assignStep,
  stats: documentStats,
};

// ===== VOC API =====

const listVocs = async (params?: Record<string, string>) => {
  if (useMockAPI && mockVocAPI) return mockVocAPI.list(params);
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const data = await get<{ results: VOC[]; count: number } | VOC[]>(`/voc/${qs}`);
  if (Array.isArray(data)) {
    return { data: { results: data, count: data.length } };
  }
  return { data };
};

const createVoc = async (input: CreateVocInput) => {
  if (useMockAPI && mockVocAPI) return mockVocAPI.create(input);
  const data = await post<VOC>('/voc/', input);
  return { data };
};

const getVoc = async (id: number) => {
  if (useMockAPI && mockVocAPI) return mockVocAPI.get(id);
  const data = await get<VOC>(`/voc/${id}/`);
  return { data };
};

const updateVocStatus = async (id: number, status: VOC['status']) => {
  if (useMockAPI && mockVocAPI) return mockVocAPI.updateStatus(id, status);
  const data = await patch<VOC>(`/voc/${id}/`, { status });
  return { data };
};

const addVocComment = async (
  id: number,
  comment: Omit<VocComment, 'id' | 'created_at'>
) => {
  if (useMockAPI && mockVocAPI) return mockVocAPI.addComment(id, comment);
  const data = await post<VOC>(`/voc/${id}/comments/`, comment);
  return { data };
};

export const vocAPI = {
  list: listVocs,
  create: createVoc,
  get: getVoc,
  updateStatus: updateVocStatus,
  addComment: addVocComment,
};

// ===== 라인 API =====

export const linesAPI = {
  list: (): Promise<Line[]> => get<Line[]>('/lines/'),
};

// ===== 공지사항 API =====

const listNotices = async () => {
  if (useMockAPI) return mockNoticesAPI.list();
  const data = await get<AdminNotice[]>('/notices/');
  return { data: Array.isArray(data) ? data : [] };
};

const latestNotice = async () => {
  if (useMockAPI) return mockNoticesAPI.latest();
  const data = await get<AdminNotice | null>('/notices/latest/');
  return { data };
};

const getNotice = async (id: number) => {
  if (useMockAPI) return mockNoticesAPI.get(id);
  const data = await get<AdminNotice>(`/notices/${id}/`);
  return { data };
};

const createNotice = async (input: CreateNoticeInput) => {
  if (useMockAPI) return mockNoticesAPI.create(input);
  const data = await post<AdminNotice>('/notices/', input);
  return { data };
};

const updateNotice = async (id: number, input: UpdateNoticeInput) => {
  if (useMockAPI) return mockNoticesAPI.update(id, input);
  const data = await patch<AdminNotice>(`/notices/${id}/`, input);
  return { data };
};

const deleteNotice = async (id: number) => {
  if (useMockAPI) return mockNoticesAPI.delete(id);
  await request(`/notices/${id}/`, { method: 'DELETE' });
  return { data: null };
};

export const noticesAPI = {
  list: listNotices,
  latest: latestNotice,
  get: getNotice,
  create: createNotice,
  update: updateNotice,
  delete: deleteNotice,
};

// ===== 가이드 API =====

const listGuides = async (params?: { section?: string; search?: string }) => {
  const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
  const data = await get<{ results: Guide[]; count: number } | Guide[]>(`/guides/${qs}`);
  if (Array.isArray(data)) {
    return { data: { results: data, count: data.length } };
  }
  return { data };
};

const getGuide = async (id: number) => {
  const data = await get<Guide>(`/guides/${id}/`);
  return { data };
};

const createGuide = async (input: CreateGuideInput) => {
  const data = await post<Guide>('/guides/', input);
  return { data };
};

const updateGuide = async (id: number, input: Partial<CreateGuideInput>) => {
  const data = await patch<Guide>(`/guides/${id}/`, input);
  return { data };
};

const deleteGuide = async (id: number) => {
  await request(`/guides/${id}/`, { method: 'DELETE' });
  return { data: null };
};

export const guidesAPI = {
  list: listGuides,
  get: getGuide,
  create: createGuide,
  update: updateGuide,
  delete: deleteGuide,
};

// ===== 폼 옵션 API =====

const getOptions = (url: string): Promise<string[]> =>
  get<{ options: string[] }>(url).then((r) => r.options);

export const formOptionsAPI = {
  getProcesses: (line: string): Promise<string[]> =>
    getOptions(`/form-options/processes/?line=${encodeURIComponent(line)}`),

  getProducts: (line: string, process?: string): Promise<string[]> => {
    const params = new URLSearchParams({ line });
    if (process) {
      params.append('process', process);
    }
    return getOptions(`/form-options/products/?${params.toString()}`);
  },

  getProcessId: (line: string, product: string): Promise<string[]> =>
    getOptions(`/form-options/process-id/?line=${encodeURIComponent(line)}&product=${encodeURIComponent(product)}`),

  getStepInfo: (line: string, process: string): Promise<StepInfo[]> =>
    get<{ options: StepInfo[] }>(`/form-options/step-info/?line=${encodeURIComponent(line)}&process=${encodeURIComponent(process)}`)
      .then((r) => r.options || []),
};
