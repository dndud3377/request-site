// ⚠️ MASKING 처리된 파일. 이 파일에 포함된 비즈니스 용어는 {{ko.json}} 키로 마스킹되어 있습니다. 원래 용어를 확인하려면 다음 파일을 참조하세요: frontend/src/locales/ko.json
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RequestDocument, AgentType, ApprovalStepFrontend, UserRole, MockUser, UserRoleWithNull } from '../types';
import { MOCK_USERS } from '../contexts/AuthContext';

const formatDate = (d: string | null): string => (d ? new Date(d).toLocaleDateString('ko-KR') : '-');

export const ROLE_TO_AGENT: Partial<Record<UserRole, AgentType>> = {
  TE_R: 'R',
  TE_J: 'J',
  TE_O: 'O',
  TE_E: 'E',
};

// 담당자 지정 가능 여부: 같은 팀, pending, 아직 담당자 없음
// password 필드가 optional이도록 수정
export const canUserAssign = (user: { role: UserRoleWithNull } | MockUser, step: ApprovalStepFrontend): boolean => {
  if (!user.role) return false;
  const agent = ROLE_TO_AGENT[user.role];
  return !!agent && step.agent === agent && step.action === 'pending' && !step.assignee_id;
};

// 합의/반려 가능 여부: MASTER이거나, 담당자로 지정된 본인
// password 필드가 optional이도록 수정
export const canUserAgree = (user: { role: UserRoleWithNull; id: number } | MockUser, step: ApprovalStepFrontend): boolean => {
  if (user.role === 'MASTER') return true;
  return step.action === 'pending' && step.assignee_id === user.id;
};

interface ApprovalFlowProps {
  doc: RequestDocument;
  onAgree: (agent: AgentType) => void;
  onReject: (agent: AgentType) => void;
  onAssign: (agent: AgentType, userId: number, userName: string) => void;
  processing: boolean;
  currentUser: MockUser;
}

export default function ApprovalFlow({ doc, onAgree, onReject, onAssign, processing, currentUser }: ApprovalFlowProps): React.ReactElement {
  const { t } = useTranslation();
  const steps = doc.approval_steps ?? [];

  const [assigningAgent, setAssigningAgent] = useState<AgentType | null>(null);
  const [assigningUserId, setAssigningUserId] = useState<string>('');

  const getStep = (agent: AgentType): ApprovalStepFrontend | undefined =>
    steps.find((s) => s.agent === agent);

  const rStep = getStep('R');
  const jStep = getStep('J');
  const oStep = getStep('O');
  const eStep = getStep('E');

  let hasPlel = false;
  try {
    const parsed = JSON.parse(doc.additional_notes ?? '{}');
    const jayerRows = parsed?.jayerRows ?? [];
    // PP 에 PLEL 포함 여부 검사 (대소문자 구분 없음)
    hasPlel = jayerRows.some((row: any) => 
      row.pp?.toLowerCase().includes('plel')
    );
  } catch { hasPlel = false; }

  const renderStepBadge = (step: ApprovalStepFrontend | undefined, label: string) => {
    if (!step) {
      return (
        <div className="approval-node approval-node-inactive">
          <span className="step-agent-label">{label}</span>
          <span className="step-badge step-badge-future">{t('approval.step_future')}</span>
        </div>
      );
    }

    const canAssign = canUserAssign(currentUser, step);
    const canAct = canUserAgree(currentUser, step);
    const isAssigning = assigningAgent === step.agent;

    // 이 agent 팀에 속한 팀원 목록 (role이 null이 아닌 경우만)
    const teamMembers = MOCK_USERS.filter((u): boolean => {
      if (!u.role) return false;
      const agent = ROLE_TO_AGENT[u.role as UserRole];
      return agent === step.agent;
    });

    // 담당자가 지정된 경우 라벨에 담당자 이름 포함 (예: {{approval.agent_R}} (오우영))
    const displayLabel = step.assignee_name ? `${label} (${step.assignee_name})` : label;

    return (
      <div className={`approval-node ${step.action === 'approved' ? 'approval-node-done' : step.action === 'rejected' ? 'approval-node-rejected' : ''}`}>
        <span className="step-agent-label">{displayLabel}</span>
        <span className={`step-badge step-badge-${step.action}`}>
          {step.action === 'approved' ? t('approval.step_approved') : step.action === 'rejected' ? t('approval.step_rejected') : t('approval.step_pending')}
        </span>
        {step.acted_at && <span className="step-acted-at">{formatDate(step.acted_at)}</span>}
        {step.comment && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2, display: 'block', maxWidth: 120, wordBreak: 'break-all' }}>
            "{step.comment}"
          </span>
        )}
        {/* 지정하기 버튼 (미지정 상태, 같은 팀) */}
        {step.action === 'pending' && canAssign && !isAssigning && (
          <div style={{ marginTop: 6 }}>
            <button
              className="btn btn-secondary btn-sm"
              disabled={processing}
              onClick={() => { setAssigningAgent(step.agent); setAssigningUserId(''); }}
            >
              지정하기
            </button>
          </div>
        )}
        {/* 팀원 선택 드롭다운 */}
        {step.action === 'pending' && isAssigning && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={assigningUserId}
              onChange={(e) => setAssigningUserId(e.target.value)}
              style={{ fontSize: '0.8rem', padding: '2px 4px', borderRadius: 4, border: '1px solid var(--border)' }}
            >
              <option value="">선택하세요</option>
              {teamMembers.map((u) => (
                <option key={u.id} value={String(u.id)}>{u.name}</option>
              ))}
            </select>
            <button
              className="btn btn-primary btn-sm"
              disabled={!assigningUserId || processing}
              onClick={() => {
                const user = teamMembers.find((u) => u.id === Number(assigningUserId));
                if (user) {
                  onAssign(step.agent, user.id, user.name);
                  setAssigningAgent(null);
                  setAssigningUserId('');
                }
              }}
            >
              확인
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { setAssigningAgent(null); setAssigningUserId(''); }}
            >
              취소
            </button>
          </div>
        )}
        {/* 합의/반려 버튼 (담당자 본인) */}
        {step.action === 'pending' && canAct && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={processing}
              onClick={() => onAgree(step.agent)}
            >
              {t('approval.agree')}
            </button>
            <button
              className="btn btn-danger btn-sm"
              disabled={processing}
              onClick={() => onReject(step.agent)}
            >
              {t('approval.reject')}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="approval-flow">
      <div className="approval-node approval-node-start">
        <span className="step-agent-label">{t('common.status_submitted')}</span>
        <span className="step-badge step-badge-approved">✓</span>
        {doc.submitted_at && <span className="step-acted-at">{formatDate(doc.submitted_at)}</span>}
      </div>
      <div className="approval-connector" />
      {renderStepBadge(rStep, t('approval.agent_R'))}
      <div className="approval-connector" />
      <div className="approval-parallel">
        {renderStepBadge(jStep, t('approval.agent_J'))}
        {renderStepBadge(oStep, t('approval.agent_O'))}
      </div>
      <div className="approval-connector" />
      {(hasPlel || eStep) && (
        <>
          {renderStepBadge(eStep, t('approval.agent_E'))}
          <div className="approval-connector" />
        </>
      )}
      <div className={`approval-node ${doc.status === 'approved' ? 'approval-node-done' : 'approval-node-inactive'}`}>
        <span className="step-agent-label">{t('common.status_approved')}</span>
        {doc.status === 'approved' && <span className="step-badge step-badge-approved">{t('approval.step_done')}</span>}
      </div>
    </div>
  );
}
