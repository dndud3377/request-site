import React, { createContext, useContext, useState } from 'react';
import { MockUser, UserRole } from '../types';

// ===== Mock Users =====

export const MOCK_USERS: MockUser[] = [
  { id: 1,  username: 'pl_user',   password: 'pass1234', name: '김의뢰', role: 'PL',     department: '마케팅팀',  email: 'pl.user@company.com' },
  { id: 2,  username: 'agent_r1',  password: 'pass1234', name: '이검토', role: 'TE_R',   department: 'AGENT R팀', email: 'agent.r1@company.com' },
  { id: 7,  username: 'agent_r2',  password: 'pass1234', name: '김R',   role: 'TE_R',   department: 'AGENT R팀', email: 'agent.r2@company.com' },
  { id: 8,  username: 'agent_r3',  password: 'pass1234', name: '박R',   role: 'TE_R',   department: 'AGENT R팀', email: 'agent.r3@company.com' },
  { id: 3,  username: 'agent_j1',  password: 'pass1234', name: '박제이', role: 'TE_J',   department: 'AGENT J팀', email: 'agent.j1@company.com' },
  { id: 9,  username: 'agent_j2',  password: 'pass1234', name: '김J',   role: 'TE_J',   department: 'AGENT J팀', email: 'agent.j2@company.com' },
  { id: 10, username: 'agent_j3',  password: 'pass1234', name: '이J',   role: 'TE_J',   department: 'AGENT J팀', email: 'agent.j3@company.com' },
  { id: 4,  username: 'agent_o1',  password: 'pass1234', name: '최오이', role: 'TE_O',   department: 'AGENT O팀', email: 'agent.o1@company.com' },
  { id: 11, username: 'agent_o2',  password: 'pass1234', name: '김O',   role: 'TE_O',   department: 'AGENT O팀', email: 'agent.o2@company.com' },
  { id: 12, username: 'agent_o3',  password: 'pass1234', name: '이O',   role: 'TE_O',   department: 'AGENT O팀', email: 'agent.o3@company.com' },
  { id: 5,  username: 'agent_e1',  password: 'pass1234', name: '정이이', role: 'TE_E',   department: 'AGENT E팀', email: 'agent.e1@company.com' },
  { id: 13, username: 'agent_e2',  password: 'pass1234', name: '김E',   role: 'TE_E',   department: 'AGENT E팀', email: 'agent.e2@company.com' },
  { id: 14, username: 'agent_e3',  password: 'pass1234', name: '이E',   role: 'TE_E',   department: 'AGENT E팀', email: 'agent.e3@company.com' },
  { id: 6,  username: 'master',    password: 'pass1234', name: '관리자', role: 'MASTER', department: '관리팀',    email: 'master@company.com' },
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
  switchUser: (userId: number) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'approval_system_user_id';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<MockUser>(() => {
    const savedId = localStorage.getItem(STORAGE_KEY);
    const found = savedId ? MOCK_USERS.find((u) => u.id === Number(savedId)) : null;
    return found ?? MOCK_USERS[0]; // 기본: PL
  });

  const switchUser = (userId: number) => {
    const user = MOCK_USERS.find((u) => u.id === userId);
    if (user) {
      setCurrentUser(user);
      localStorage.setItem(STORAGE_KEY, String(userId));
    }
  };

  return (
    <AuthContext.Provider value={{ currentUser, switchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
