import {
  RequestDocument,
  VOC,
  Stats,
  Line,
  CreateDocumentInput,
  UpdateDocumentInput,
  CreateVocInput,
  AgentType,
} from '../types';

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
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const data = await get<{ results: RequestDocument[]; count: number } | RequestDocument[]>(
    `/documents/${qs}`
  );
  // DRF pagination or plain array
  if (Array.isArray(data)) {
    return { data: { results: data, count: data.length } };
  }
  return { data };
};

const getDocument = async (id: number) => {
  const data = await get<RequestDocument>(`/documents/${id}/`);
  return { data };
};

const createDocument = async (input: CreateDocumentInput) => {
  const data = await post<RequestDocument>('/documents/', input);
  return { data };
};

const updateDocument = async (id: number, input: UpdateDocumentInput) => {
  const data = await patch<RequestDocument>(`/documents/${id}/`, input);
  return { data };
};

const submitDocument = async (id: number) => {
  const data = await post<{ message: string; email_sent: boolean; document: RequestDocument }>(
    `/documents/${id}/submit/`
  );
  return { data };
};

const resubmitDocument = async (id: number) => {
  const data = await post<{ message: string; document: RequestDocument }>(
    `/documents/${id}/resubmit/`
  );
  return { data };
};

const withdrawDocument = async (id: number) => {
  const data = await post<{ message: string }>(`/documents/${id}/withdraw/`);
  return { data };
};

const approveStep = async (docId: number, agent: AgentType, comment?: string) => {
  const data = await post<{ message: string; status: string }>(
    `/documents/${docId}/approve-step/`,
    { agent, comment: comment ?? '' }
  );
  return { data };
};

const rejectStep = async (docId: number, agent: AgentType, comment?: string) => {
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
  const data = await post<{ message: string }>(`/documents/${docId}/assign-step/`, {
    agent,
    assignee_id: assigneeId,
    assignee_name: assigneeName,
  });
  return { data };
};

const documentStats = async () => {
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
  approveStep,
  rejectStep,
  assignStep,
  stats: documentStats,
};

// ===== VOC API =====

const listVocs = async (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const data = await get<{ results: VOC[]; count: number } | VOC[]>(`/voc/${qs}`);
  if (Array.isArray(data)) {
    return { data: { results: data, count: data.length } };
  }
  return { data };
};

const createVoc = async (input: CreateVocInput) => {
  const data = await post<VOC>('/voc/', input);
  return { data };
};

const getVoc = async (id: number) => {
  const data = await get<VOC>(`/voc/${id}/`);
  return { data };
};

export const vocAPI = {
  list: listVocs,
  create: createVoc,
  get: getVoc,
};

// ===== 라인 API =====

export const linesAPI = {
  list: (): Promise<Line[]> => get<Line[]>('/lines/'),
};
