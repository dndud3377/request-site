import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router-dom';
import { documentsAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { useAuth, MOCK_USERS } from '../contexts/AuthContext';
import PagedDetailView from '../components/PagedDetailView';
import { canUserAgree, canUserAssign, ROLE_TO_AGENT } from '../components/ApprovalFlow';
import { RequestDocument, AgentType } from '../types';

// ===== Utils =====

const formatDate = (d: string | null): string => (d ? new Date(d).toLocaleDateString('ko-KR') : '-');

const getCurrentStage = (doc: RequestDocument, t: TFunction): string => {
  const steps = doc.approval_steps ?? [];
  const pending = steps.filter((s) => s.action === 'pending');
  if (pending.length === 0 && doc.status === 'approved') return t('common.status_approved');
  if (pending.length === 0) return '-';
  return pending.map((s) => `AGENT ${s.agent}`).join(' / ');
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

  const openDetail = (doc: RequestDocument) => {
    setSelected(doc);
    setPageIdx(0);
    setAssigningOpen(false);
    setAssigningUserId('');
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
        addToast(t('approval.agree_success', { agent: pendingAction.agent }), 'success');
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

  const handleAssign = async (agent: AgentType, userId: number, userName: string) => {
    if (!selected) return;
    setProcessing(true);
    try {
      await documentsAPI.assignStep(selected.id, agent, userId, userName);
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleWithdraw = async (doc: RequestDocument) => {
    if (!window.confirm(t('approval.withdraw_confirm'))) return;
    setProcessing(true);
    try {
      await documentsAPI.withdraw(doc.id);
      addToast(t('approval.withdraw_success'), 'success');
      setModalOpen(false);
      fetchDocs();
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleEditResubmit = (doc: RequestDocument) => {
    setModalOpen(false);
    navigate('/request', { state: { editDocId: doc.id } });
  };

  const isPL = currentUser.role === 'PL';
  const isMaster = currentUser.role === 'MASTER';

  // 모달 내 comment 목록 (합의/반려된 step의 코멘트)
  const stepComments = selected?.approval_steps?.filter((s) => s.comment && s.action !== 'pending') ?? [];

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
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(isPL || isMaster) && doc.status === 'rejected' && (
                        <button className="btn btn-primary btn-sm" onClick={() => handleEditResubmit(doc)}>
                          {t('approval.edit_resubmit')}
                        </button>
                      )}
                      {(isPL || isMaster) && (doc.status === 'under_review' || doc.status === 'rejected') && (
                        <button className="btn btn-secondary btn-sm" onClick={() => handleWithdraw(doc)} disabled={processing}>
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
          title={pendingAction.type === 'agree' ? t('approval.modal_agree_title', { agent: pendingAction.agent }) : t('approval.modal_reject_title', { agent: pendingAction.agent })}
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

      {/* 상세 모달 */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={selected?.title ?? ''}
        size="lg"
        footer={(() => {
          const userAgent = ROLE_TO_AGENT[currentUser.role];
          const pendingSteps = selected?.approval_steps?.filter((s) =>
            s.action === 'pending' && (isMaster ? true : s.agent === userAgent)
          ) ?? [];
          const assignableStep = pendingSteps.find((s) => canUserAssign(currentUser, s));
          const actableStep = pendingSteps.find((s) => canUserAgree(currentUser, s));
          const teamMembers = assignableStep
            ? MOCK_USERS.filter((u) => ROLE_TO_AGENT[u.role] === assignableStep.agent)
            : [];
          return (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center' }}>
              {selected && (isPL || isMaster) && selected.status === 'rejected' && (
                <button className="btn btn-primary" onClick={() => handleEditResubmit(selected)}>
                  {t('approval.edit_resubmit')}
                </button>
              )}
              {selected && (isPL || isMaster) && (selected.status === 'under_review' || selected.status === 'rejected') && (
                <button className="btn btn-secondary" onClick={() => handleWithdraw(selected)} disabled={processing}>
                  {t('approval.withdraw')}
                </button>
              )}
              {assignableStep && !assigningOpen && (
                <button
                  className="btn btn-secondary"
                  disabled={processing}
                  onClick={() => { setAssigningOpen(true); setAssigningUserId(''); }}
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
                    <option value="">담당자 선택</option>
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
                        handleAssign(assignableStep.agent, user.id, user.name);
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
            {/* 현재 역할 표시 */}
            <div style={{ background: 'var(--accent-light)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600 }}>
              {t('approval.current_role')} {ROLE_LABEL[currentUser.role]} ({currentUser.name})
            </div>

            {/* 상태 + 합의/반려 이유 */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <StatusBadge status={selected.status} />
              {stepComments.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {stepComments.map((s) => (
                    <div
                      key={s.id}
                      style={{
                        fontSize: '0.8rem',
                        color: s.action === 'rejected' ? '#dc3545' : 'var(--text-secondary)',
                        background: s.action === 'rejected' ? '#fff0f0' : 'var(--bg-secondary)',
                        border: `1px solid ${s.action === 'rejected' ? '#f5c6cb' : 'var(--border)'}`,
                        borderRadius: 'var(--radius-sm)',
                        padding: '4px 10px',
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>AGENT {s.agent} ({s.action === 'approved' ? t('approval.agree') : t('approval.reject')})</span>: {s.comment}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 페이지 네비게이션 + 의뢰 상세 */}
            <PagedDetailView
              doc={selected}
              role={currentUser.role}
              pageIdx={pageIdx}
              setPageIdx={setPageIdx}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
