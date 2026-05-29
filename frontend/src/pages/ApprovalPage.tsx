import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router-dom';
import { documentsAPI, usersAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import PagedDetailView from '../components/PagedDetailView';
import { canUserAgree, canUserAssign, ROLE_TO_AGENT } from '../components/ApprovalFlow';
import { RequestDocument, AgentType, UserRole, UserWithRole } from '../types';

const AGENT_TO_ROLE: Record<string, string> = {
  R: 'TE_R',
  J: 'TE_J',
  O: 'TE_O',
  E: 'TE_E',
};

// ===== Utils =====

const formatDate = (d: string | null): string => (d ? new Date(d).toLocaleDateString('ko-KR') : '-');

// EUV 단계 포함 여부 확인
const hasEUVStep = (doc: RequestDocument): boolean => {
  // 1. 이미 EUV 단계가 존재하는지 확인
  const steps = doc.approval_steps ?? [];
  const eStep = steps.find((s) => s.agent === 'E');
  if (eStep) return true;
  
  // 2. J/O 모두 합의되었는데 EUV 가 없으면 PLEL 없음
  const jStep = steps.find((s) => s.agent === 'J');
  const oStep = steps.find((s) => s.agent === 'O');
  const jApproved = jStep?.action === 'approved';
  const oApproved = oStep?.action === 'approved';
  
  if (jApproved && oApproved && !eStep) {
    return false;
  }
  
  // 3. 아직 진행 중이면 additional_notes 에서 PLEL 확인
  try {
    const parsed = JSON.parse(doc.additional_notes ?? '{}');
    const jayerRows = parsed?.jayerRows ?? [];
    return jayerRows.some((row: any) => 
      row.pp?.toLowerCase().includes('plel')
    );
  } catch {
    return false;
  }
};

// 단계별 소요 일수
const getStageDuration = (agent: AgentType): number => {
  switch (agent) {
    case 'R': return 1;
    case 'J':
    case 'O': return 4;
    case 'E': return 3;
    default: return 0;
  }
};

// 현재 단계 완료일 계산
const formatCurrentStageCompletionDate = (doc: RequestDocument): string => {
  if (!doc.submitted_at) return '-';
  
  const steps = doc.approval_steps ?? [];
  const completedSteps = steps.filter((s) => s.action !== 'pending');
  const pendingSteps = steps.filter((s) => s.action === 'pending');
  
  if (pendingSteps.length === 0) return '-';
  
  const currentAgent = pendingSteps[0].agent;
  
  // 기준 시간: 상신일 + 완료된 단계들의 실제 소요시간
  const baseDate = new Date(doc.submitted_at);
  let elapsedDays = 0;
  
  // 완료된 단계들의 실제 소요시간 계산
  completedSteps.forEach((step) => {
    if (step.acted_at && doc.submitted_at) {
      const stepDuration = Math.ceil(
        (new Date(step.acted_at).getTime() - new Date(doc.submitted_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      elapsedDays = Math.max(elapsedDays, stepDuration);
    }
  });
  
  // 현재 단계의 예상 완료일
  const expectedDate = new Date(baseDate);
  expectedDate.setDate(expectedDate.getDate() + elapsedDays + getStageDuration(currentAgent));
  
  return expectedDate.toLocaleDateString('ko-KR');
};

// 최종 완료 예상일 계산 (EUV 조건 반영)
const formatFinalCompletionDate = (doc: RequestDocument): string => {
  if (!doc.submitted_at) return '-';
  
  const steps = doc.approval_steps ?? [];
  const completedSteps = steps.filter((s) => s.action !== 'pending');
  const pendingSteps = steps.filter((s) => s.action === 'pending');
  
  const baseDate = new Date(doc.submitted_at);
  
  // 완료된 단계들의 실제 소요시간 계산 (병렬은 긴 쪽)
  let actualDays = 0;
  const completedAgents = new Set<AgentType>();
  
  completedSteps.forEach((step) => {
    if (step.acted_at && doc.submitted_at) {
      const stepDuration = Math.ceil(
        (new Date(step.acted_at).getTime() - new Date(doc.submitted_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      actualDays = Math.max(actualDays, stepDuration);
      completedAgents.add(step.agent);
    }
  });
  
  // 남은 단계들의 고정 소요시간 계산
  let remainingDays = 0;
  pendingSteps.forEach((step) => {
    // 이미 완료된 에이전트는 제외 (병렬 중복 방지)
    if (!completedAgents.has(step.agent)) {
      remainingDays += getStageDuration(step.agent);
    }
  });
  
  // 최종 예상일 = 상신일 + 실제경과일 + 남은단계고정합
  const finalDate = new Date(baseDate);
  finalDate.setDate(finalDate.getDate() + actualDays + remainingDays);
  
  return finalDate.toLocaleDateString('ko-KR');
};

const getCurrentStage = (doc: RequestDocument, t: TFunction): string => {
  const steps = doc.approval_steps ?? [];
  const maxRound = steps.reduce((m, s) => Math.max(m, s.round ?? 1), 0) || 1;
  const currentSteps = steps.filter((s) => (s.round ?? 1) === maxRound);
  const pending = currentSteps.filter((s) => s.action === 'pending');
  if (pending.length === 0 && doc.status === 'approved') return t('common.status_approved');
  if (pending.length === 0) return '-';

  const agentToLabel: Record<string, string> = {
    'R': t('approval.agent_R'),
    'J': t('approval.agent_J'),
    'O': t('approval.agent_O'),
    'E': t('approval.agent_E'),
  };

  return pending.map((s) => {
    const label = agentToLabel[s.agent] || s.agent;
    return label;
  }).join(' / ');
};

// ===== (ApprovalFlow, PagedDetailView are imported from components/) =====

// ===== Main Page =====

interface FilterTab {
  key: string;
  label: string;
}

export default function ApprovalPage(): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToast();
  const { currentUser } = useAuth();

  const [docs, setDocs] = useState<RequestDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RequestDocument | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);

  // 합의/반려 comment 모달
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: 'agree' | 'reject'; agent: AgentType } | null>(null);
  const [commentInput, setCommentInput] = useState('');

  // 지정하기 UI (모달 footer)
  const [assigningOpen, setAssigningOpen] = useState(false);
  const [assigningUserId, setAssigningUserId] = useState('');
  const [teamMembers, setTeamMembers] = useState<UserWithRole[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const handleLoadTeamMembers = async (agent: AgentType): Promise<UserWithRole[]> => {
    const role = AGENT_TO_ROLE[agent];
    if (!role) return [];
    const res = await usersAPI.list(role);
    return res.data;
  };

  const fetchDocs = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (filter) params.status = filter;
    if (search) params.search = search;
    documentsAPI
      .list(params)
      .then((r) => {
        const data = r.data;
        let all: RequestDocument[] = Array.isArray(data) ? data : (data as any).results ?? [];
        // 결재 현황: approved 제외
        all = all.filter((d) => d.status !== 'approved');
        setDocs(all);
      })
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [filter, search]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const filterTabs: FilterTab[] = [
    { key: '', label: t('approval.filter_all') },
    { key: 'draft', label: t('approval.filter_draft') },
    { key: 'under_review', label: t('approval.filter_under_review') },
    { key: 'rejected', label: t('approval.filter_rejected') },
  ];

  const openDetail = async (doc: RequestDocument) => {
    try {
      const detailResult = await documentsAPI.get(doc.id);
      setSelected(detailResult.data);
    } catch {
      setSelected(doc);
    }
    setPageIdx(0);
    setAssigningOpen(false);
    setAssigningUserId('');
    setTeamMembers([]);
    setModalOpen(true);
  };

  const refreshAndSelect = async (docId: number) => {
    const listResult = await documentsAPI.list({});
    const listData = listResult.data;
    let newDocs: RequestDocument[] = Array.isArray(listData) ? listData : (listData as any).results ?? [];
    newDocs = newDocs.filter((d) => d.status !== 'approved');
    setDocs(newDocs);
    const refreshed = newDocs.find((d) => d.id === docId);
    if (refreshed) setSelected(refreshed);
  };

  // 합의/반려 버튼 클릭 → comment 모달 열기
  const triggerAgree = (agent: AgentType) => {
    setPendingAction({ type: 'agree', agent });
    setCommentInput('');
    setCommentModalOpen(true);
  };

  const triggerReject = (agent: AgentType) => {
    setPendingAction({ type: 'reject', agent });
    setCommentInput('');
    setCommentModalOpen(true);
  };

  const handleConfirmAction = async () => {
    if (!selected || !pendingAction) return;
    setCommentModalOpen(false);
    setProcessing(true);
    try {
      if (pendingAction.type === 'agree') {
        await documentsAPI.approveStep(selected.id, pendingAction.agent, commentInput || undefined);
        addToast(t('approval.agree_success', { agent: t(`approval.agent_${pendingAction.agent}` as any) }), 'success');
        setModalOpen(false);
        fetchDocs();
      } else {
        await documentsAPI.rejectStep(selected.id, pendingAction.agent, commentInput || undefined);
        addToast(t('approval.reject_success'), 'error');
        await refreshAndSelect(selected.id);
      }
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
      setPendingAction(null);
    }
  };

  const handleAssign = async (agent: AgentType, loginid: string, userName: string) => {
    if (!selected) return;
    setProcessing(true);
    try {
      await documentsAPI.assignStep(selected.id, agent, loginid, userName);
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  // 철회 모달 상태
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawDoc, setWithdrawDoc] = useState<RequestDocument | null>(null);

  const handleWithdrawClick = (doc: RequestDocument) => {
    setWithdrawDoc(doc);
    setWithdrawModalOpen(true);
  };

  const handleWithdrawToDraft = async () => {
    if (!withdrawDoc) return;
    setProcessing(true);
    try {
      await documentsAPI.withdraw(withdrawDoc.id);
      addToast(t('approval.withdraw_success'), 'success');
      setWithdrawModalOpen(false);
      setModalOpen(false);
      fetchDocs();
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
      setWithdrawDoc(null);
    }
  };

  const handleDelete = async () => {
    if (!withdrawDoc) return;
    setProcessing(true);
    try {
      await documentsAPI.delete(withdrawDoc.id);
      addToast('의뢰서가 삭제되었습니다.', 'success');
      setWithdrawModalOpen(false);
      setModalOpen(false);
      fetchDocs();
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
      setWithdrawDoc(null);
    }
  };

  const handleEditResubmit = (doc: RequestDocument) => {
    setModalOpen(false);
    navigate('/request', { state: { editDocId: doc.id } });
  };

  const isPL = currentUser.role === 'PL';
  const isMaster = currentUser.role === 'MASTER';

  return (
    <div className="container page">
      <div className="page-header">
        <h1>{t('approval.title')}</h1>
        <p>{t('approval.subtitle')}</p>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('approval.search_placeholder')}
          />
        </div>
        <div className="filter-tabs">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              className={`filter-tab ${filter === tab.key ? 'active' : ''}`}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="empty-state"><p>{t('common.loading')}</p></div>
      ) : docs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <p>{t('approval.no_data')}</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>{t('approval.col_title')}</th>
                <th>{t('approval.col_product')}</th>
                <th>{t('approval.col_requester')}</th>
                <th>{t('approval.col_status')}</th>
                <th>{t('approval.col_current_stage')}</th>
                <th>{t('approval.col_submitted')}</th>
                <th>{t('approval.col_current_stage_completion')}</th>
                <th>{t('approval.col_final_completion')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <button
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontWeight: 600, fontSize: '0.9rem', textAlign: 'left', padding: 0 }}
                      onClick={() => openDetail(doc)}
                    >
                      {doc.title}
                    </button>
                  </td>
                  <td>{doc.product_name}</td>
                  <td>
                    <div>{doc.requester_name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{doc.requester_department}</div>
                  </td>
                  <td><StatusBadge status={doc.status} /></td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 500 }}>
                    {getCurrentStage(doc, t)}
                  </td>
                  <td>{formatDate(doc.submitted_at)}</td>
                  <td>{formatCurrentStageCompletionDate(doc)}</td>
                  <td>{formatFinalCompletionDate(doc)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(isPL || isMaster) && (doc.status === 'rejected' || doc.status === 'draft') && (
                        <button className="btn btn-primary btn-sm" onClick={() => handleEditResubmit(doc)}>
                          {t('approval.edit_resubmit')}
                        </button>
                      )}
                      {(isPL || isMaster) && (doc.status === 'under_review' || doc.status === 'rejected' || doc.status === 'draft') && (
                        <button className="btn btn-secondary btn-sm" onClick={() => handleWithdrawClick(doc)} disabled={processing}>
                          {t('approval.withdraw')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 합의/반려 이유 입력 모달 */}
      {commentModalOpen && pendingAction && (
        <Modal
          isOpen={commentModalOpen}
          onClose={() => { setCommentModalOpen(false); setPendingAction(null); }}
          title={pendingAction.type === 'agree' ? t('approval.modal_agree_title', { agent: t(`approval.agent_${pendingAction.agent}` as any) }) : t('approval.modal_reject_title', { agent: t(`approval.agent_${pendingAction.agent}` as any) })}
          size="md"
          topLevel
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className={pendingAction.type === 'agree' ? 'btn btn-primary' : 'btn btn-danger'}
                onClick={handleConfirmAction}
                disabled={processing}
              >
                {t('common.confirm')}
              </button>
              <button className="btn btn-secondary" onClick={() => { setCommentModalOpen(false); setPendingAction(null); }}>
                {t('common.cancel')}
              </button>
            </div>
          }
        >
          <div>
            <p style={{ marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              {pendingAction.type === 'agree' ? t('approval.comment_agree_label') : t('approval.comment_reject_label')}
            </p>
            <textarea
              className="form-control"
              rows={4}
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              placeholder={pendingAction.type === 'agree' ? t('approval.comment_agree_placeholder') : t('approval.comment_reject_placeholder')}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </div>
        </Modal>
      )}

      {/* 철회/삭제 선택 모달 */}
      {withdrawModalOpen && (
        <Modal
          isOpen={withdrawModalOpen}
          onClose={() => { setWithdrawModalOpen(false); setWithdrawDoc(null); }}
          title="철회 방식 선택"
          size="md"
          topLevel
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary"
                onClick={handleWithdrawToDraft}
                disabled={processing}
              >
                임시저장
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={processing}
              >
                삭제
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => { setWithdrawModalOpen(false); setWithdrawDoc(null); }}
                disabled={processing}
              >
                취소
              </button>
            </div>
          }
        >
          <div>
            <p style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
              의뢰서를 철회하는 방식을 선택해주세요.
            </p>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-sm)', marginTop: 12 }}>
              <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>📝 임시저장</p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                의뢰서가 임시저장 상태로 돌아갑니다. 이후 수정하여 재상신할 수 있습니다.
              </p>
            </div>
            <div style={{ background: '#fff0f0', padding: '12px', borderRadius: 'var(--radius-sm)', marginTop: 8 }}>
              <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#dc3545', marginBottom: 8 }}>🗑️ 삭제</p>
              <p style={{ fontSize: '0.8rem', color: '#dc3545', margin: 0 }}>
                의뢰서가 완전히 삭제됩니다. 복구할 수 없습니다.
              </p>
            </div>
          </div>
        </Modal>
      )}

      {/* 상세 모달 */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={selected?.title ?? ''}
        size="lg"
        footer={(() => {
          const userAgent = currentUser.role ? ROLE_TO_AGENT[currentUser.role] : undefined;
          const pendingSteps = selected?.approval_steps?.filter((s) =>
            s.action === 'pending' && (isMaster ? true : s.agent === userAgent)
          ) ?? [];
          const assignableStep = pendingSteps.find((s) => canUserAssign(currentUser, s));
          const actableStep = pendingSteps.find((s) => canUserAgree(currentUser, s));
          return (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center' }}>
              {selected && (isPL || isMaster) && (selected.status === 'rejected' || selected.status === 'draft') && (
                <button className="btn btn-primary" onClick={() => handleEditResubmit(selected)}>
                  {t('approval.edit_resubmit')}
                </button>
              )}
              {selected && (isPL || isMaster) && (selected.status === 'under_review' || selected.status === 'rejected' || selected.status === 'draft') && (
                <button className="btn btn-secondary" onClick={() => handleWithdrawClick(selected)} disabled={processing}>
                  {t('approval.withdraw')}
                </button>
              )}
              {assignableStep && !assigningOpen && (
                <button
                  className="btn btn-secondary"
                  disabled={processing}
                  onClick={async () => {
                    setAssigningOpen(true);
                    setAssigningUserId('');
                    setLoadingMembers(true);
                    const members = await handleLoadTeamMembers(assignableStep.agent);
                    setTeamMembers(members);
                    setLoadingMembers(false);
                  }}
                >
                  지정하기
                </button>
              )}
              {assignableStep && assigningOpen && (
                <>
                  <select
                    value={assigningUserId}
                    onChange={(e) => setAssigningUserId(e.target.value)}
                    style={{ fontSize: '0.85rem', padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)' }}
                  >
                    {loadingMembers
                      ? <option>로딩 중...</option>
                      : <>
                          <option value="">담당자 선택</option>
                          {teamMembers.map((u) => (
                            <option key={u.loginid} value={u.loginid}>{u.name}</option>
                          ))}
                        </>
                    }
                  </select>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!assigningUserId || processing || loadingMembers}
                    onClick={() => {
                      const user = teamMembers.find((u) => u.loginid === assigningUserId);
                      if (user) {
                        handleAssign(assignableStep.agent, user.loginid, user.name);
                        setAssigningOpen(false);
                        setAssigningUserId('');
                      }
                    }}
                  >
                    확인
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setAssigningOpen(false); setAssigningUserId(''); }}
                  >
                    취소
                  </button>
                </>
              )}
              {actableStep && (
                <>
                  <button
                    className="btn btn-primary"
                    disabled={processing}
                    onClick={() => triggerAgree(actableStep.agent)}
                  >
                    {t('approval.agree')}
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={processing}
                    onClick={() => triggerReject(actableStep.agent)}
                  >
                    {t('approval.reject')}
                  </button>
                </>
              )}
              <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>
                {t('common.close')}
              </button>
            </div>
          );
        })()}
      >
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <StatusBadge status={selected.status} />

            {/* 페이지 네비게이션 + 의뢰 상세 */}
            <PagedDetailView
              doc={selected}
              role={currentUser.role as UserRole}
              pageIdx={pageIdx}
              setPageIdx={setPageIdx}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
