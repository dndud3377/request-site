import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RequestDocument, AgentType, ApprovalStepFrontend, UserRole, MockUser } from '../types';
import { MOCK_USERS } from '../contexts/AuthContext';

const formatDate = (d: string | null): string => (d ? new Date(d).toLocaleDateString('ko-KR') : '-');

export const ROLE_TO_AGENT: Partial<Record<UserRole, AgentType>> = {
  TE_R: 'R',
  TE_J: 'J',
  TE_O: 'O',
  TE_E: 'E',
};

// 담당자 지정 가능 여부: 같은 팀, pending, 아직 담당자 없음
export const canUserAssign = (user: MockUser, step: ApprovalStepFrontend): boolean => {
  const agent = ROLE_TO_AGENT[user.role];
  return !!agent && step.agent === agent && step.action === 'pending' && !step.assignee_id;
};

// 합의/반려 가능 여부: MASTER이거나, 담당자로 지정된 본인
export const canUserAgree = (user: MockUser, step: ApprovalStepFrontend): boolean => {
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

  let sugarAdd = false;
  try {
    const parsed = JSON.parse(doc.additional_notes ?? '{}');
    sugarAdd = parsed?.detail?.sugar_add === '예';
  } catch { sugarAdd = false; }

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

    // 이 agent 팀에 속한 팀원 목록
    const teamMembers = MOCK_USERS.filter((u) => ROLE_TO_AGENT[u.role] === step.agent);

    return (
      <div className={`approval-node ${step.action === 'approved' ? 'approval-node-done' : step.action === 'rejected' ? 'approval-node-rejected' : ''}`}>
        <span className="step-agent-label">{label}</span>
        <span className={`step-badge step-badge-${step.action}`}>
          {step.action === 'approved' ? t('approval.step_approved') : step.action === 'rejected' ? t('approval.step_rejected') : t('approval.step_pending')}
        </span>
        {step.acted_at && <span className="step-acted-at">{formatDate(step.acted_at)}</span>}
        {/* 합의/반려 완료 시 담당자 이름 표시 */}
        {(step.action === 'approved' || step.action === 'rejected') && step.assignee_name && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: 2 }}>
            담당: {step.assignee_name}
          </span>
        )}
        {step.comment && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2, display: 'block', maxWidth: 120, wordBreak: 'break-all' }}>
            "{step.comment}"
          </span>
        )}
        {/* 담당자 표시 (pending) */}
        {step.action === 'pending' && (
          <span style={{ fontSize: '0.72rem', color: step.assignee_name ? 'var(--text-secondary)' : 'var(--text-muted)', marginTop: 2, display: 'block' }}>
            {step.assignee_name ? `담당자: ${step.assignee_name}` : '담당자: 미지정'}
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
      {renderStepBadge(rStep, 'AGENT R')}
      <div className="approval-connector" />
      <div className="approval-parallel">
        {renderStepBadge(jStep, 'AGENT J')}
        {renderStepBadge(oStep, 'AGENT O')}
      </div>
      <div className="approval-connector" />
      {(sugarAdd || eStep) && (
        <>
          {renderStepBadge(eStep, 'AGENT E')}
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
