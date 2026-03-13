import { mockDocumentsAPI, mockVocAPI, mockRfgAPI } from './mock';
import { MOCK_USERS } from '../contexts/AuthContext';
import { UserRole } from '../types';

export const documentsAPI = mockDocumentsAPI;
export const vocAPI = mockVocAPI;
export const rfgAPI = mockRfgAPI;

export const authAPI = {
  getUserByRole: (role: UserRole) => MOCK_USERS.find((u) => u.role === role) ?? MOCK_USERS[0],
};
