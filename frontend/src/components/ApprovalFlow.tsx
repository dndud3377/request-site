// ⚠️ MASKING 처리된 파일. 이 파일에 포함된 비즈니스 용어는 {{ko.json}} 키로 마스킹되어 있습니다. 원래 용어를 확인하려면 다음 파일을 참조하세요: frontend/src/locales/ko.json
import { ApprovalStepFrontend, UserRole, MockUser, UserRoleWithNull } from '../types';

export const ROLE_TO_AGENT: Partial<Record<UserRole, string>> = {
  TE_R: 'R',
  TE_P: 'P',
  TE_J: 'J',
  TE_O: 'O',
  TE_E: 'E',
};

// 검토중(claim) 방식으로 전환된 단계 — 지정하기 대신 담당 역할이 스스로 선점한다.
export const CLAIM_AGENTS = ['J', 'O', 'E', 'P'];

// P/E 단계 검토자 agent 코드 (담당자가 검토중 선점 후 지정, 다중 가능)
export const REVIEW_AGENT_OF: Partial<Record<string, string>> = { P: 'PV', E: 'EV' };

// 담당자 지정(지정하기) 가능 여부: R 전용
// - PL: 상신 시 이미 지정됨 → 불필요
// - J/O/E/P: 검토중(claim) 방식 → 지정하기 없음
// - R: 같은 팀, pending, 아직 담당자 없음
export const canUserAssign = (user: { role: UserRoleWithNull } | MockUser, step: ApprovalStepFrontend): boolean => {
  if (!user.role) return false;
  if (step.agent === 'PL' || CLAIM_AGENTS.includes(step.agent)) return false;
  const agent = ROLE_TO_AGENT[user.role];
  return !!agent && step.agent === agent && step.action === 'pending' && !step.assignee_loginid;
};

// 검토중(claim) 가능 여부: J/O/E/P 단계에서 담당 역할이 아직 미배정 단계를 선점
// - 같은 팀(역할↔agent 일치), pending, 아직 담당자 없음
export const canUserClaim = (user: { role: UserRoleWithNull } | MockUser, step: ApprovalStepFrontend): boolean => {
  if (!user.role) return false;
  if (!CLAIM_AGENTS.includes(step.agent)) return false;
  if (step.action !== 'pending' || step.assignee_loginid) return false;
  const agent = ROLE_TO_AGENT[user.role];
  return !!agent && step.agent === agent;
};

// 합의/반려 가능 여부
// - MASTER: 항상 가능
// - J/O/E/P(검토중): 누군가 검토중으로 선점(assignee 존재)하면 같은 팀(역할↔agent) 누구나 합의/반려
// - PL 역할: agent='PL' 단계에서 본인이 assignee일 때 (검토 처리)
// - 나머지(R·RV·PV·EV·RA): 담당자로 지정된 본인
export const canUserAgree = (user: { role: UserRoleWithNull; username: string } | MockUser, step: ApprovalStepFrontend): boolean => {
  if (user.role === 'MASTER') return true;
  if (step.action !== 'pending') return false;
  if (CLAIM_AGENTS.includes(step.agent)) {
    // 아직 검토중 선점 전이면 불가(먼저 검토중 필요), 선점 후엔 같은 팀 누구나
    if (!step.assignee_loginid) return false;
    return !!user.role && ROLE_TO_AGENT[user.role] === step.agent;
  }
  if (user.role === 'PL' && step.agent === 'PL') {
    return step.assignee_loginid === user.username;
  }
  return step.assignee_loginid === user.username;
};

// P/E 검토자 선택 UI 노출 가능 여부: 이 단계에 합의할 수 있는 사람(=담당자 본인/MASTER)과 동일하다.
// R 담당자 지정과 달리 별도 지정 API가 없다 — 검토자를 고른 뒤 '합의'를 누르면 그 요청 한 번에
// 담당자 합의 + 검토자 지정이 함께 처리된다(canUserAgree와 조건이 같지만 P/E 전용으로 한정).
export const canUserPickReviewers = (user: { role: UserRoleWithNull; username: string } | MockUser, step: ApprovalStepFrontend): boolean => {
  if (!REVIEW_AGENT_OF[step.agent]) return false;
  if (step.action !== 'pending') return false;
  if (user.role === 'MASTER') return true;
  return !!step.assignee_loginid && step.assignee_loginid === user.username;
};
