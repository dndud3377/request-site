// ⚠️ MASKING 처리된 파일. 이 파일에 포함된 비즈니스 용어는 {{ko.json}} 키로 마스킹되어 있습니다. 원래 용어를 확인하려면 다음 파일을 참조하세요: frontend/src/locales/ko.json
import { ApprovalStepFrontend, UserRole, MockUser, UserRoleWithNull } from '../types';

export const ROLE_TO_AGENT: Partial<Record<UserRole, string>> = {
  TE_R: 'R',
  TE_P: 'P',
  TE_J: 'J',
  TE_O: 'O',
  TE_E: 'E',
};

// 담당자 지정 가능 여부: 같은 팀, pending, 아직 담당자 없음 (TE_O/TE_E는 지정 불필요)
export const canUserAssign = (user: { role: UserRoleWithNull } | MockUser, step: ApprovalStepFrontend): boolean => {
  if (!user.role) return false;
  if (user.role === 'TE_O' || user.role === 'TE_E') return false;
  const agent = ROLE_TO_AGENT[user.role];
  return !!agent && step.agent === agent && step.action === 'pending' && !step.assignee_loginid;
};

// 합의/반려 가능 여부: MASTER이거나, TE_O/TE_E는 자기 단계 pending이면 누구나, 나머지는 담당자로 지정된 본인
export const canUserAgree = (user: { role: UserRoleWithNull; username: string } | MockUser, step: ApprovalStepFrontend): boolean => {
  if (user.role === 'MASTER') return true;
  if (step.action !== 'pending') return false;
  const agent = user.role ? ROLE_TO_AGENT[user.role] : undefined;
  if ((user.role === 'TE_O' || user.role === 'TE_E') && agent && step.agent === agent) return true;
  return step.assignee_loginid === user.username;
};
