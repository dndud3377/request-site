import {
  RequestDocument,
  VOC,
  Stats,
  Line,
  CreateDocumentInput,
  UpdateDocumentInput,
  CreateVocInput,
  AgentType,
  StepInfo,
} from '../types';
import { mockDocumentsAPI, mockVocAPI } from './mock';

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
