import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { MockUser, UserInfo, UserRole } from '../types';
import { authAPI, setToken, clearToken } from '../api/client';

const IS_DEV_MODE = process.env.REACT_APP_AUTH_MODE === 'dev';

// ===== Mock Users (dev 유저 전환용) =====

export const MOCK_USERS: MockUser[] = [
  { id: 1,  username: 'pl_user',  name: '김의뢰', role: 'PL',     department: '마케팅팀',  email: 'pl.user@company.com' },
  { id: 2,  username: 'agent_r1', name: '이검토', role: 'TE_R',   department: 'AGENT R팀', email: 'agent.r1@company.com' },
  { id: 7,  username: 'agent_r2', name: '김R',   role: 'TE_R',   department: 'AGENT R팀', email: 'agent.r2@company.com' },
  { id: 8,  username: 'agent_r3', name: '박R',   role: 'TE_R',   department: 'AGENT R팀', email: 'agent.r3@company.com' },
  { id: 3,  username: 'agent_j1', name: '박제이', role: 'TE_J',   department: 'AGENT J팀', email: 'agent.j1@company.com' },
  { id: 9,  username: 'agent_j2', name: '김J',   role: 'TE_J',   department: 'AGENT J팀', email: 'agent.j2@company.com' },
  { id: 10, username: 'agent_j3', name: '이J',   role: 'TE_J',   department: 'AGENT J팀', email: 'agent.j3@company.com' },
  { id: 4,  username: 'agent_o1', name: '최오이', role: 'TE_O',   department: 'AGENT O팀', email: 'agent.o1@company.com' },
  { id: 11, username: 'agent_o2', name: '김O',   role: 'TE_O',   department: 'AGENT O팀', email: 'agent.o2@company.com' },
  { id: 12, username: 'agent_o3', name: '이O',   role: 'TE_O',   department: 'AGENT O팀', email: 'agent.o3@company.com' },
  { id: 5,  username: 'agent_e1', name: '정이이', role: 'TE_E',   department: 'AGENT E팀', email: 'agent.e1@company.com' },
  { id: 13, username: 'agent_e2', name: '김E',   role: 'TE_E',   department: 'AGENT E팀', email: 'agent.e2@company.com' },
  { id: 14, username: 'agent_e3', name: '이E',   role: 'TE_E',   department: 'AGENT E팀', email: 'agent.e3@company.com' },
  { id: 6,  username: 'master',   name: '관리자', role: 'MASTER', department: '관리팀',    email: 'master@company.com' },
];

export const ROLE_LABEL: Record<UserRole, string> = {
  PL:     '제품 담당자',
  TE_R:   'AGENT R팀',
  TE_J:   'AGENT J팀',
  TE_O:   'AGENT O팀',
  TE_E:   'AGENT E팀',
  MASTER: '관리자',
  NONE:   '미지정',
};

// ===== Context =====

interface AuthContextValue {
  currentUser: UserInfo;
  isLoggedIn: boolean;
  isLoading: boolean;
  loginSSO: () => Promise<void>;
  logout: () => void;
  switchUser: (username: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'approval_system_user_id';
const INACTIVITY_MS = 60 * 60 * 1000;

const EMPTY_USER: UserInfo = { id: 0, username: '', name: '', role: 'PL', department: '', email: '' };

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserInfo>(EMPTY_USER);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(!IS_DEV_MODE);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ===== 초기화: 세션 복원 (운영) / dev 자동 로그인 =====
  useEffect(() => {
    if (IS_DEV_MODE) {
      const savedId = localStorage.getItem(STORAGE_KEY);
      const found = savedId ? MOCK_USERS.find(u => u.id === Number(savedId)) : null;
      const devUser = found ?? MOCK_USERS[0];
      setCurrentUser(devUser as unknown as UserInfo);
      authAPI.devLogin(devUser.username)
        .then((res: any) => setToken(res.access))
        .catch(() => clearToken());
      setIsLoggedIn(true);
      return;
    }

    // 운영 모드: /api/auth/me/ 최대 5회 재시도
    const MAX_RETRIES = 5;
    let cancelled = false;

    (async () => {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (cancelled) return;
        try {
          const res = await authAPI.me();
          if (cancelled) return;
          setCurrentUser(res.user);
          setIsLoggedIn(true);
          setIsLoading(false);
          return;
        } catch (e) {
          // HTTP errors (401, 403, 5xx) → no retry, network errors → retry with backoff
          if (e instanceof Error && e.message.startsWith('HTTP ')) break;
          if (attempt < MAX_RETRIES - 1) {
            await sleep((attempt + 1) * 1000);
          }
        }
      }
      if (!cancelled) setIsLoading(false);
    })();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== 1시간 비활동 자동 로그아웃 =====
  useEffect(() => {
    if (!isLoggedIn) return;

    const handleTimeout = async () => {
      try { await authAPI.oidcLogout(); } catch {}
      clearToken();
      setIsLoggedIn(false);
      setCurrentUser(EMPTY_USER);
      window.location.href = '/?reason=inactive';
    };

    const resetTimer = () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = setTimeout(handleTimeout, INACTIVITY_MS);
    };

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach(e => document.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      events.forEach(e => document.removeEventListener(e, resetTimer));
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, [isLoggedIn]);

  const loginSSO = async () => {
    const res = await authAPI.oidcLogin();
    if (res.nonce_jwt) localStorage.setItem('oidc_state_jwt', res.nonce_jwt);
    window.location.href = res.redirect_url;
  };

  const logout = () => {
    clearToken();
    setIsLoggedIn(false);
    setCurrentUser(EMPTY_USER);
  };

  const switchUser = async (username: string) => {
    if (!IS_DEV_MODE) return;
    const user = MOCK_USERS.find(u => u.username === username);
    if (!user) return;
    setCurrentUser(user as unknown as UserInfo);
    localStorage.setItem(STORAGE_KEY, String(user.id));
    try {
      const res: any = await authAPI.devLogin(username);
      setToken(res.access);
    } catch {
      clearToken();
    }
  };

  return (
    <AuthContext.Provider value={{ currentUser, isLoggedIn, isLoading, loginSSO, logout, switchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
