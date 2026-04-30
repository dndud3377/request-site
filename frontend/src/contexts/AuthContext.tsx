import React, { createContext, useContext, useEffect, useState } from 'react';
import { MockUser, UserRole } from '../types';
import { authAPI, setToken, clearToken } from '../api/client';

const IS_DEV_MODE = process.env.REACT_APP_AUTH_MODE === 'dev';

// ===== Mock Users (역할 테스트용 유저 목록) =====

export const MOCK_USERS: MockUser[] = [
  { id: 1,  username: 'pl_user',  password: 'pass1234', name: '김의뢰', role: 'PL',     department: '마케팅팀',  email: 'pl.user@company.com' },
  { id: 2,  username: 'agent_r1', password: 'pass1234', name: '이검토', role: 'TE_R',   department: 'AGENT R팀', email: 'agent.r1@company.com' },
  { id: 7,  username: 'agent_r2', password: 'pass1234', name: '김R',   role: 'TE_R',   department: 'AGENT R팀', email: 'agent.r2@company.com' },
  { id: 8,  username: 'agent_r3', password: 'pass1234', name: '박R',   role: 'TE_R',   department: 'AGENT R팀', email: 'agent.r3@company.com' },
  { id: 3,  username: 'agent_j1', password: 'pass1234', name: '박제이', role: 'TE_J',   department: 'AGENT J팀', email: 'agent.j1@company.com' },
  { id: 9,  username: 'agent_j2', password: 'pass1234', name: '김J',   role: 'TE_J',   department: 'AGENT J팀', email: 'agent.j2@company.com' },
  { id: 10, username: 'agent_j3', password: 'pass1234', name: '이J',   role: 'TE_J',   department: 'AGENT J팀', email: 'agent.j3@company.com' },
  { id: 4,  username: 'agent_o1', password: 'pass1234', name: '최오이', role: 'TE_O',   department: 'AGENT O팀', email: 'agent.o1@company.com' },
  { id: 11, username: 'agent_o2', password: 'pass1234', name: '김O',   role: 'TE_O',   department: 'AGENT O팀', email: 'agent.o2@company.com' },
  { id: 12, username: 'agent_o3', password: 'pass1234', name: '이O',   role: 'TE_O',   department: 'AGENT O팀', email: 'agent.o3@company.com' },
  { id: 5,  username: 'agent_e1', password: 'pass1234', name: '정이이', role: 'TE_E',   department: 'AGENT E팀', email: 'agent.e1@company.com' },
  { id: 13, username: 'agent_e2', password: 'pass1234', name: '김E',   role: 'TE_E',   department: 'AGENT E팀', email: 'agent.e2@company.com' },
  { id: 14, username: 'agent_e3', password: 'pass1234', name: '이E',   role: 'TE_E',   department: 'AGENT E팀', email: 'agent.e3@company.com' },
  { id: 6,  username: 'master',   password: 'pass1234', name: '관리자', role: 'MASTER', department: '관리팀',    email: 'master@company.com' },
];

export const ROLE_LABEL: Record<UserRole, string> = {
  PL:     '제품 담당자',
  TE_R:   'AGENT R팀',
  TE_J:   'AGENT J팀',
  TE_O:   'AGENT O팀',
  TE_E:   'AGENT E팀',
  MASTER: '관리자',
};

// ===== Context =====

interface AuthContextValue {
  currentUser: MockUser;
  isLoggedIn: boolean;
  login: () => Promise<void>;
  logout: () => void;
  switchUser: (username: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'approval_system_user_id';
const LOGGED_IN_KEY = 'approval_system_logged_in';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<MockUser>(() => {
    const savedId = localStorage.getItem(STORAGE_KEY);
    const found = savedId ? MOCK_USERS.find((u) => u.id === Number(savedId)) : null;
    return found ?? MOCK_USERS[0];
  });

  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(
    () => IS_DEV_MODE ? true : localStorage.getItem(LOGGED_IN_KEY) === 'true'
  );

  useEffect(() => {
    if (IS_DEV_MODE) {
      // dev 모드: 저장된 유저 또는 첫 번째 유저로 자동 로그인
      authAPI.devLogin(currentUser.username)
        .then((res: any) => setToken(res.access))
        .catch(() => clearToken());
    } else {
      // 운영 모드: 저장된 로그인 상태 복원
      if (!isLoggedIn) return;
      authAPI.login(currentUser.username, currentUser.password)
        .then((res) => setToken(res.access))
        .catch(() => clearToken());
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async () => {
    try {
      if (IS_DEV_MODE) {
        const res: any = await authAPI.devLogin(currentUser.username);
        setToken(res.access);
      } else {
        const res = await authAPI.login(currentUser.username, currentUser.password);
        setToken(res.access);
      }
    } catch {
      clearToken();
    }
    setIsLoggedIn(true);
    localStorage.setItem(LOGGED_IN_KEY, 'true');
  };

  const logout = () => {
    clearToken();
    setIsLoggedIn(false);
    localStorage.removeItem(LOGGED_IN_KEY);
  };

  const switchUser = async (username: string) => {
    const user = MOCK_USERS.find((u) => u.username === username);
    if (!user) return;

    setCurrentUser(user);
    localStorage.setItem(STORAGE_KEY, String(user.id));

    try {
      if (IS_DEV_MODE) {
        const res: any = await authAPI.devLogin(username);
        setToken(res.access);
      } else {
        const res = await authAPI.login(user.username, user.password);
        setToken(res.access);
      }
    } catch {
      clearToken();
    }
  };

  return (
    <AuthContext.Provider value={{ currentUser, isLoggedIn, login, logout, switchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
