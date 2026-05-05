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
  ExternalBbDataItem,
  StepOption,
  AdminNotice,
  CreateNoticeInput,
  UpdateNoticeInput,
  Guide,
  CreateGuideInput,
  UserInfo,
  UserWithRole,
  CreateUserInput,
} from '../types';

// ===== JWT 토큰 관리 =====

const TOKEN_KEY = 'access_token';

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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

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
  me: () =>
    get<{ user: UserInfo }>('/auth/me/'),
  refresh: () =>
    post<{ success: boolean; user: UserInfo }>('/auth/refresh/'),
  oidcLogin: () =>
    get<{ redirect_url: string; nonce_jwt?: string }>('/auth/oidc/login/'),
  oidcCallback: (data: { id_token: string; state?: string; nonce_jwt?: string }) =>
    post<{ success?: boolean; redirect_url?: string; user?: unknown }>('/auth/oidc/callback/', data),
  oidcLogout: () =>
    post<{ message: string; logout_url: string }>('/auth/oidc/logout/'),
  devLogin: (username: string) =>
    post<{ access: string; refresh: string; user: unknown }>('/auth/dev-login/', { username }),
};

// ===== 의뢰서 API =====

const listDocuments = async (params?: Record<string, string>) => {
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

const deleteDocument = async (id: number) => {
  const data = await post<{ message: string }>(`/documents/${id}/delete/`);
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

const getApprovedDocuments = async (product_name?: string): Promise<{ data: RequestDocument[] }> => {
  const params: Record<string, string> = { status: 'approved' };
  if (product_name) params.product_name = product_name;
  const qs = '?' + new URLSearchParams(params).toString();
  const data = await get<RequestDocument[]>(`/documents/${qs}`);
  return { data: Array.isArray(data) ? data : (data as any).results ?? [] };
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
  getApproved: getApprovedDocuments,
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

const updateVocStatus = async (id: number, status: VOC['status']) => {
  const data = await patch<VOC>(`/voc/${id}/`, { status });
  return { data };
};

const updateVocResponse = async (id: number, response: string) => {
  const data = await patch<VOC>(`/voc/${id}/`, { response });
  return { data };
};

const addVocComment = async (id: number, comment: {
  author_name: string;
  author_role: string;
  is_submitter: boolean;
  content: string;
  is_reject_reason: boolean;
}) => {
  const data = await post<VOC>(`/voc/${id}/comment/`, comment);
  return { data };
};

export const vocAPI = {
  list: listVocs,
  create: createVoc,
  get: getVoc,
  updateStatus: updateVocStatus,
  updateResponse: updateVocResponse,
  addComment: addVocComment,
};

// ===== 라인 API =====

export const linesAPI = {
  list: (): Promise<Line[]> => get<Line[]>('/lines/'),
};

// ===== 공지사항 API =====

const listNotices = async () => {
  const data = await get<AdminNotice[]>('/notices/');
  return { data };
};

const latestNotice = async () => {
  const data = await get<AdminNotice | null>('/notices/latest/');
  return { data: data ?? null };
};

const getNotice = async (id: number) => {
  const data = await get<AdminNotice>(`/notices/${id}/`);
  return { data };
};

const createNotice = async (input: CreateNoticeInput) => {
  const data = await post<AdminNotice>('/notices/', input);
  return { data: data ?? null };
};

const updateNotice = async (id: number, input: UpdateNoticeInput) => {
  const data = await patch<AdminNotice>(`/notices/${id}/`, input);
  return { data: data ?? null };
};

const deleteNotice = async (id: number) => {
  await request(`/notices/${id}/`, { method: 'DELETE' });
  return { data: undefined };
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

// ===== 사용자 관리 API =====

const listUsers = async (): Promise<{ data: UserWithRole[] }> => {
  const data = await get<{ results: UserWithRole[]; count: number } | UserWithRole[]>('/users/');
  if (Array.isArray(data)) return { data };
  return { data: (data as { results: UserWithRole[] }).results };
};

const createUser = async (input: CreateUserInput): Promise<{ data: UserWithRole }> => {
  const data = await post<UserWithRole>('/users/', input);
  return { data };
};

const deleteUser = async (id: number): Promise<void> => {
  await request(`/users/${id}/`, { method: 'DELETE' });
};

const getUsersForAssignment = async (): Promise<{ data: UserForAssignment[] }> => {
  const data = await get<UserForAssignment[]>('/users/for-assignment/');
  return { data: Array.isArray(data) ? data : [] };
};

const assignRole = async (userId: number, role: UserRole): Promise<{ data: UserWithRole }> => {
  const data = await post<UserWithRole>(`/users/${userId}/assign-role/`, { role });
  return { data };
};

export const usersAPI = {
  list: listUsers,
  create: createUser,
  remove: deleteUser,
  forAssignment: getUsersForAssignment,
  assignRole: assignRole,
};

// ===== 폼 옵션 API =====

const getOptions = (url: string): Promise<string[]> =>
  get<{ options: string[] }>(url).then((r) => r.options);

const getStepOptions = (url: string): Promise<StepInfo[]> =>
  get<{ options: StepInfo[] }>(url).then((r) => r.options || []);

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

  getJobFileLayer: (line: string, process: string): Promise<StepInfo[]> =>
    getStepOptions(`/form-options/job-file-layer/?line=${encodeURIComponent(line)}&process=${encodeURIComponent(process)}`),

  getOvlLayer: (line: string, process: string): Promise<StepInfo[]> =>
    getStepOptions(`/form-options/ovl-layer/?line=${encodeURIComponent(line)}&process=${encodeURIComponent(process)}`),

  getBbExternalData: (entry: { location: string; product: string; process_id: string }): Promise<StepOption[]> => {
    return get<{ options: StepOption[] }>(
      `/form-options/bb-external/?location=${encodeURIComponent(entry.location)}&product=${encodeURIComponent(entry.product)}&process_id=${encodeURIComponent(entry.process_id)}`
    ).then((r) => r.options || []);
  },
};

// ===== 이미지 업로드 API =====

export interface UploadImageResult {
  path: string;
  url: string;
  original_name: string;
  size: number;
}

export const uploadImageAPI = {
  upload: (file: File): Promise<UploadImageResult> => {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('image', file);

      fetch(`${BASE_URL}/upload-image/`, {
        method: 'POST',
        headers,
        body: formData,
        credentials: 'include',
      })
        .then(async (res) => {
          if (!res.ok) {
            let errMsg = `HTTP ${res.status}`;
            try {
              const body = await res.json();
              errMsg = body.error || JSON.stringify(body);
            } catch {
              //
            }
            throw new Error(errMsg);
          }
          return res.json();
        })
        .then((data: UploadImageResult) => resolve(data))
        .catch((err) => reject(err));
    });
  },
};
