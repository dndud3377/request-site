import React, { createContext, useContext, useState, useEffect } from 'react';
import { MockUser, UserRole } from '../types';

// ===== Mock Users =====

export const MOCK_USERS: MockUser[] = [
  { id: 1, username: 'pl_user',  password: 'pass1234', name: '김의뢰', role: 'PL',     department: '마케팅팀',  email: 'pl.user@company.com' },
  { id: 2, username: 'agent_r',  password: 'pass1234', name: '이검토', role: 'TE_R',   department: 'AGENT R팀', email: 'agent.r@company.com' },
  { id: 3, username: 'agent_j',  password: 'pass1234', name: '박제이', role: 'TE_J',   department: 'AGENT J팀', email: 'agent.j@company.com' },
  { id: 4, username: 'agent_o',  password: 'pass1234', name: '최오이', role: 'TE_O',   department: 'AGENT O팀', email: 'agent.o@company.com' },
  { id: 5, username: 'agent_e',  password: 'pass1234', name: '정이이', role: 'TE_E',   department: 'AGENT E팀', email: 'agent.e@company.com' },
  { id: 6, username: 'master',   password: 'pass1234', name: '관리자', role: 'MASTER', department: '관리팀',    email: 'master@company.com' },
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
  switchRole: (role: UserRole) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'approval_system_role';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<MockUser>(() => {
    const savedRole = localStorage.getItem(STORAGE_KEY) as UserRole | null;
    const found = savedRole ? MOCK_USERS.find((u) => u.role === savedRole) : null;
    return found ?? MOCK_USERS[0]; // 기본: PL
  });

  const switchRole = (role: UserRole) => {
    const user = MOCK_USERS.find((u) => u.role === role);
    if (user) {
      setCurrentUser(user);
      localStorage.setItem(STORAGE_KEY, role);
    }
  };

  return (
    <AuthContext.Provider value={{ currentUser, switchRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
