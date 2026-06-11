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
  P: 'TE_P',
  J: 'TE_J',
  O: 'TE_O',
  E: 'TE_E',
};

// ===== Utils =====

const formatDate = (d: string | null): string => (d ? new Date(d).toLocaleDateString('ko-KR') : '-');

// TE_O/TE_E는 담당자 지정 불필요 — 나머지 단계에서 담당자 미지정 시 'unassigned' 반환
const getDisplayStatus = (doc: RequestDocument): string => {
  if (doc.status !== 'under_review') return doc.status;
  const steps = doc.approval_steps ?? [];
  const maxRound = steps.reduce((m, s) => Math.max(m, s.round ?? 1), 0) || 1;
  const pending = steps.filter((s) => (s.round ?? 1) === maxRound && s.action === 'pending');
  const needsAssignment = pending.some(
    (s) => s.agent !== 'O' && s.agent !== 'E' && !s.assignee_loginid
  );
  return needsAssignment ? 'unassigned' : 'under_review';
};

const getCurrentRound = (doc: RequestDocument): number =>
  (doc.approval_steps ?? []).reduce((m, s) => Math.max(m, s.round ?? 1), 0) || 1;

// due_date 텍스트 + CSS 클래스 반환
const getDueDateDisplay = (
  dueDate: string | null | undefined,
  isDone: boolean,
  undecidedLabel: string,
): { text: string; cls: string } => {
  if (isDone) return { text: dueDate ? formatDate(dueDate) : '-', cls: 'due-date-done' };
  if (!dueDate) return { text: undecidedLabel, cls: 'due-date-undecided' };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate); due.setHours(0, 0, 0, 0);
  if (due < today) return { text: formatDate(dueDate), cls: 'due-date-overdue' };
  if (due.getTime() === today.getTime()) return { text: formatDate(dueDate), cls: 'due-date-today' };
  return { text: formatDate(dueDate), cls: '' };
};

// 최종 완료 예상일: max(path1_end, path2_end)
// path1: J.due if exists, else P.due + 4 cal days (estimate before J is created)
// path2: max(O.due, E.due)
const getFinalCompletionDate = (doc: RequestDocument): string => {
  const maxRound = getCurrentRound(doc);
  const currentSteps = (doc.approval_steps ?? []).filter(s => (s.round ?? 1) === maxRound);
  const rStep = currentSteps.find(s => s.agent === 'R');
  if (!rStep || rStep.action !== 'approved') return '-';

  const pStep = currentSteps.find(s => s.agent === 'P');
  const jStep = currentSteps.find(s => s.agent === 'J');
  const oStep = currentSteps.find(s => s.agent === 'O');
  const eStep = currentSteps.find(s => s.agent === 'E');

  // path2: max(O.due, E.due)
  const path2Dates = [oStep?.due_date, eStep?.due_date].filter(Boolean) as string[];
  const path2End = path2Dates.length > 0 ? path2Dates.reduce((a, b) => (a > b ? a : b)) : null;

  // path1: J.due or estimated (P.due + 4 calendar days)
  let path1End: string | null = null;
  if (jStep?.due_date) {
    path1End = jStep.due_date;
  } else if (pStep?.due_date) {
    const d = new Date(pStep.due_date);
    d.setDate(d.getDate() + 4);
    path1End = d.toISOString().slice(0, 10);
  }

  const candidates = [path1End, path2End].filter(Boolean) as string[];
  if (candidates.length === 0) return '-';
  return formatDate(candidates.reduce((a, b) => (a > b ? a : b)));
};

interface DocTableRow {
  pathKey: 'single' | 'path1' | 'path2';
  stageText: string;
  dueDate: string | null;
  isDone: boolean;
  pathStatus: string; // 경로별 상태 (StatusBadge에 전달)
}

// 경로별 상태 계산: pending의 assignee 여부에 따라 unassigned / under_review / approved
const resolvePathStatus = (
  pendingStep: { agent: string; assignee_loginid?: string } | undefined,
  isDone: boolean,
  docStatus: string,
): string => {
  if (docStatus === 'rejected') return 'rejected';
  if (isDone) return 'approved';
  if (!pendingStep) return 'approved';
  return pendingStep.assignee_loginid ? 'under_review' : 'unassigned';
};

const buildStageText = (
  step: { agent: string; assignee_name?: string } | undefined,
  isDone: boolean,
  t: TFunction,
): string => {
  if (isDone) return t('common.status_approved');
  if (!step) return t('common.status_approved');
  const label = t(`approval.agent_${step.agent}` as any);
  return step.assignee_name ? `${label}(${step.assignee_name})` : label;
};

const getDocTableRows = (doc: RequestDocument, t: TFunction): DocTableRow[] => {
  const maxRound = getCurrentRound(doc);
  const currentSteps = (doc.approval_steps ?? []).filter(s => (s.round ?? 1) === maxRound);

  // PL 검토 단계 pending: 기한 없음, R 단계 미생성 상태
  const plStep = currentSteps.find(s => s.agent === 'PL');
  if (plStep?.action === 'pending') {
    const label = t('approval.agent_PL' as any);
    const stageText = plStep.assignee_name ? `${label}(${plStep.assignee_name})` : label;
    return [{
      pathKey: 'single',
      stageText,
      dueDate: null,
      isDone: false,
      pathStatus: 'under_review',
    }];
  }

  const rStep = currentSteps.find(s => s.agent === 'R');
  const inParallel = rStep?.action === 'approved';

  if (!inParallel) {
    const pending = currentSteps.filter(s => s.action === 'pending');
    if (pending.length === 0) {
      return [{
        pathKey: 'single',
        stageText: doc.status === 'approved' ? t('common.status_approved') : '-',
        dueDate: null,
        isDone: true,
        pathStatus: doc.status,
      }];
    }
    // R 단계 pending: assignee 여부로 상태 결정
    const rPending = pending.find(s => s.agent === 'R');
    const pathStatus = rPending
      ? (rPending.assignee_loginid ? 'under_review' : 'unassigned')
      : 'under_review';
    const stageText = pending
      .map(s => buildStageText(s, false, t))
      .join(' / ');
    return [{
      pathKey: 'single',
      stageText,
      dueDate: pending[0]?.due_date ?? null,
      isDone: false,
      pathStatus,
    }];
  }

  // 병렬 단계
  const pStep = currentSteps.find(s => s.agent === 'P');
  const jStep = currentSteps.find(s => s.agent === 'J');
  const oStep = currentSteps.find(s => s.agent === 'O');
  const eStep = currentSteps.find(s => s.agent === 'E');

  const path1Pending = [pStep, jStep].find(s => s?.action === 'pending');
  const path1Done = !path1Pending;

  const path2PendingSteps = ([oStep, eStep] as (typeof oStep)[]).filter(
    (s): s is NonNullable<typeof oStep> => !!s && s.action === 'pending'
  );
  const path2Done = path2PendingSteps.length === 0;
  const path2StageText = path2Done
    ? t('common.status_approved')
    : path2PendingSteps
        .map(s => {
          const label = t(`approval.agent_${s.agent}` as any);
          return s.assignee_name ? `${label}(${s.assignee_name})` : label;
        })
        .join(' / ');
  const path2DueDate = path2PendingSteps.reduce<string | null>((max, s) => {
    if (!s.due_date) return max;
    return !max || s.due_date > max ? s.due_date : max;
  }, null);

  return [
    {
      pathKey: 'path1',
      stageText: buildStageText(path1Pending, path1Done, t),
      dueDate: path1Pending?.due_date ?? null,
      isDone: path1Done,
      pathStatus: resolvePathStatus(path1Pending, path1Done, doc.status),
    },
    {
      pathKey: 'path2',
      stageText: path2StageText,
      dueDate: path2DueDate,
      isDone: path2Done,
      pathStatus: resolvePathStatus(path2PendingSteps[0], path2Done, doc.status),
    },
  ];
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
  const [allDocs, setAllDocs] = useState<RequestDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RequestDocument | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);

  // 합의/반려 comment 모달
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: 'agree' | 'reject'; agent: AgentType; isPeer?: boolean } | null>(null);
  const [commentInput, setCommentInput] = useState('');

  // 지정하기 UI (모달 footer)
  const [assigningOpen, setAssigningOpen] = useState(false);
  const [assigningUserId, setAssigningUserId] = useState('');
  const [teamMembers, setTeamMembers] = useState<UserWithRole[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // 지정자 변경 UI (모달 footer)
  const [changingDesigneeOpen, setChangingDesigneeOpen] = useState(false);
  const [changingDesigneeUserId, setChangingDesigneeUserId] = useState('');

  const handleLoadTeamMembers = async (agent: AgentType): Promise<UserWithRole[]> => {
    const role = AGENT_TO_ROLE[agent];
    if (!role) return [];
    const res = await usersAPI.list(role);
    return res.data;
  };

  const applyClientFilter = useCallback((all: RequestDocument[]): RequestDocument[] => {
    if (filter === 'draft') return all.filter(d => d.status === 'draft');
    if (filter === 'rejected') return all.filter(d => d.status === 'rejected');
    if (filter === 'my') {
      const role = currentUser.role;
      if (role === 'MASTER') return all;
      if (role === 'PL') {
        return all.filter((d) =>
          d.requester_name === currentUser.name ||
          d.designated_pl_loginid === currentUser.username
        );
      }
      if (role === 'NONE' || !role) return [];
      // TE_* 역할: 내 loginid(username)가 assignee_loginid인 pending 단계가 있는 문서
      return all.filter((d) =>
        (d.approval_steps ?? []).some(
          (s) => s.action === 'pending' && s.assignee_loginid === currentUser.username
        )
      );
    }
    if (filter.startsWith('agent_')) {
      const agent = filter.replace('agent_', '') as AgentType;
      return all.filter((d) =>
        (d.approval_steps ?? []).some((s) => s.agent === agent && s.action === 'pending')
      );
    }
    return all;
  }, [filter, currentUser]);

  const getTabCount = useCallback((key: string, base: RequestDocument[]): number => {
    if (key === '') return base.length;
    if (key === 'draft') return base.filter(d => d.status === 'draft').length;
    if (key === 'rejected') return base.filter(d => d.status === 'rejected').length;
    if (key === 'my') {
      const role = currentUser.role;
      if (role === 'MASTER') return base.length;
      if (role === 'PL') return base.filter(d =>
        d.requester_name === currentUser.name ||
        d.designated_pl_loginid === currentUser.username
      ).length;
      if (role === 'NONE' || !role) return 0;
      return base.filter(d => (d.approval_steps ?? []).some(s => s.action === 'pending' && s.assignee_loginid === currentUser.username)).length;
    }
    if (key.startsWith('agent_')) {
      const agent = key.replace('agent_', '') as AgentType;
      return base.filter(d => (d.approval_steps ?? []).some(s => s.agent === agent && s.action === 'pending')).length;
    }
    return 0;
  }, [currentUser]);

  const fetchDocs = useCallback(() => {
    setLoading(true);
    setError(false);
    const params: Record<string, string> = {};
    if (search) params.search = search;
    documentsAPI
      .list(params)
      .then((r) => {
        const data = r.data;
        let all: RequestDocument[] = Array.isArray(data) ? data : (data as any).results ?? [];
        // 결재 현황: approved 제외
        all = all.filter((d) => d.status !== 'approved');
        setAllDocs(all);
        setDocs(applyClientFilter(all));
      })
      .catch(() => { setError(true); setAllDocs([]); setDocs([]); })
      .finally(() => setLoading(false));
  }, [filter, search, applyClientFilter]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const tabBaseLabels: { key: string; baseLabel: string }[] = [
    { key: '', baseLabel: t('approval.filter_all') },
    { key: 'my', baseLabel: t('approval.filter_my') },
    { key: 'agent_R', baseLabel: t('approval.filter_agent_R') },
    { key: 'agent_P', baseLabel: t('approval.filter_agent_P') },
    { key: 'agent_J', baseLabel: t('approval.filter_agent_J') },
    { key: 'agent_O', baseLabel: t('approval.filter_agent_O') },
    { key: 'agent_E', baseLabel: t('approval.filter_agent_E') },
    { key: 'draft', baseLabel: t('approval.filter_draft') },
    { key: 'rejected', baseLabel: t('approval.filter_rejected') },
  ];
  const filterTabs: FilterTab[] = tabBaseLabels.map(({ key, baseLabel }) => {
    const count = getTabCount(key, allDocs);
    return { key, label: count > 0 ? `${baseLabel}(${count})` : baseLabel };
  });

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
    setChangingDesigneeOpen(false);
    setChangingDesigneeUserId('');
    setModalOpen(true);
  };

  const refreshAndSelect = async (docId: number) => {
    const listResult = await documentsAPI.list({});
    const listData = listResult.data;
    let newDocs: RequestDocument[] = Array.isArray(listData) ? listData : (listData as any).results ?? [];
    newDocs = newDocs.filter((d) => d.status !== 'approved');
    setAllDocs(newDocs);
    setDocs(applyClientFilter(newDocs));
    const freshDoc = await documentsAPI.get(docId).then(r => r.data).catch(() => newDocs.find(d => d.id === docId));
    if (freshDoc) setSelected(freshDoc);
  };

  // 합의/반려 버튼 클릭 → comment 모달 열기
  const triggerAgree = (agent: AgentType, isPeer = false) => {
    setPendingAction({ type: 'agree', agent, isPeer });
    setCommentInput('');
    setCommentModalOpen(true);
  };

  const triggerReject = (agent: AgentType, isPeer = false) => {
    setPendingAction({ type: 'reject', agent, isPeer });
    setCommentInput('');
    setCommentModalOpen(true);
  };

  const handleConfirmAction = async () => {
    if (!selected || !pendingAction) return;
    setCommentModalOpen(false);
    setProcessing(true);
    try {
      if (pendingAction.isPeer) {
        if (pendingAction.type === 'agree') {
          await documentsAPI.peerApprove(selected.id, commentInput || undefined);
          addToast(t('approval.agree_success', { agent: t('approval.agent_PL' as any) }), 'success');
          setModalOpen(false);
          fetchDocs();
        } else {
          await documentsAPI.peerReject(selected.id, commentInput || undefined);
          addToast(t('approval.reject_success'), 'error');
          await refreshAndSelect(selected.id);
        }
      } else if (pendingAction.type === 'agree') {
        await documentsAPI.approveStep(selected.id, pendingAction.agent, commentInput || undefined, currentUser.name);
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

  const handlePeerSubmitNav = (doc: RequestDocument) => {
    setModalOpen(false);
    navigate('/request', { state: { peerReviewDocId: doc.id } });
  };

  const handleChangeDesignee = async () => {
    if (!selected || !changingDesigneeUserId) return;
    setProcessing(true);
    try {
      await documentsAPI.changeDesignee(selected.id, changingDesigneeUserId);
      setChangingDesigneeOpen(false);
      setChangingDesigneeUserId('');
      setTeamMembers([]);
      addToast('지정자가 변경되었습니다.', 'success');
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
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
  const isNone = currentUser.role === 'NONE';

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
      ) : error ? (
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <p>{t('common.load_error')}</p>
          <button className="btn" onClick={fetchDocs}>{t('common.retry')}</button>
        </div>
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
                <th>{t('approval.col_current_stage')}</th>
                <th>{t('approval.col_current_stage_completion')}</th>
                <th>{t('approval.col_final_completion')}</th>
                <th>{t('approval.col_production_date')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.flatMap((doc) => {
                const rows = getDocTableRows(doc, t);
                const isParallel = rows.length === 2;
                const undecided = t('approval.due_date_undecided');
                return rows.map((row, idx) => {
                  const dd = getDueDateDisplay(row.dueDate, row.isDone, undecided);
                  return (
                    <tr
                      key={`${doc.id}-${idx}`}
                      className={isParallel ? (idx === 0 ? 'doc-row-first' : 'doc-row-second') : ''}
                    >
                      {idx === 0 && (
                        <td rowSpan={rows.length}>
                          {isNone ? (
                            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{doc.title}</span>
                          ) : (
                            <button
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontWeight: 600, fontSize: '0.9rem', textAlign: 'left', padding: 0 }}
                              onClick={() => openDetail(doc)}
                            >
                              {doc.title}
                            </button>
                          )}
                        </td>
                      )}
                      {idx === 0 && <td rowSpan={rows.length}>{doc.product_name}</td>}
                      {idx === 0 && (
                        <td rowSpan={rows.length}>
                          <div>{doc.requester_name}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{doc.requester_department}</div>
                        </td>
                      )}
                      <td style={{ fontWeight: 500 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <StatusBadge status={row.pathStatus} />
                          <span style={{ color: row.isDone ? 'var(--text-disabled)' : 'var(--text-primary)' }}>{row.stageText}</span>
                        </div>
                      </td>
                      <td>
                        <span className={dd.cls}>{dd.text}</span>
                      </td>
                      {idx === 0 && <td rowSpan={rows.length}>{getFinalCompletionDate(doc)}</td>}
                      {idx === 0 && <td rowSpan={rows.length}>{doc.production_date ? formatDate(doc.production_date) : '-'}</td>}
                      {idx === 0 && (
                        <td rowSpan={rows.length}>
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
                      )}
                    </tr>
                  );
                });
              })}
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
          const pendingSteps = selected?.approval_steps?.filter((s) => {
            if (s.action !== 'pending') return false;
            if (isMaster) return true;
            if (isPL && s.agent === 'PL') return true;
            return s.agent === userAgent;
          }) ?? [];
          const assignableStep = pendingSteps.find((s) => canUserAssign(currentUser, s));
          const actableStep = pendingSteps.find((s) => canUserAgree(currentUser, s));
          const isPLStep = actableStep?.agent === 'PL';

          // 지정자 변경 가능 여부: 원 PL 또는 MASTER, under_review, PL 단계 pending
          const hasPendingPLStep = (selected?.approval_steps ?? []).some(s => s.agent === 'PL' && s.action === 'pending');
          const isOriginalPL = isPL && selected?.requester_name === currentUser.name;
          const canChangeDesignee = (isOriginalPL || isMaster) && selected?.status === 'under_review' && hasPendingPLStep;

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
              {/* 지정자 변경 */}
              {canChangeDesignee && !changingDesigneeOpen && !assigningOpen && (
                <button
                  className="btn btn-secondary"
                  disabled={processing}
                  onClick={async () => {
                    setChangingDesigneeOpen(true);
                    setChangingDesigneeUserId('');
                    setLoadingMembers(true);
                    const members = await usersAPI.list('PL');
                    setTeamMembers(members.data.filter(u => u.loginid !== currentUser.username));
                    setLoadingMembers(false);
                  }}
                >
                  {t('approval.change_designee')}
                </button>
              )}
              {canChangeDesignee && changingDesigneeOpen && (
                <>
                  <select
                    value={changingDesigneeUserId}
                    onChange={(e) => setChangingDesigneeUserId(e.target.value)}
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
                    disabled={!changingDesigneeUserId || processing || loadingMembers}
                    onClick={handleChangeDesignee}
                  >
                    변경
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setChangingDesigneeOpen(false); setChangingDesigneeUserId(''); setTeamMembers([]); }}
                  >
                    취소
                  </button>
                </>
              )}
              {/* 일반 담당자 지정 (R/P/J 단계) */}
              {assignableStep && !assigningOpen && !changingDesigneeOpen && (
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
              {/* PL 검토 단계 액션 */}
              {actableStep && isPLStep && selected && (
                <>
                  <button className="btn btn-primary" disabled={processing} onClick={() => triggerAgree(actableStep.agent, true)}>
                    {t('approval.agree')}
                  </button>
                  <button className="btn btn-danger" disabled={processing} onClick={() => triggerReject(actableStep.agent, true)}>
                    {t('approval.reject')}
                  </button>
                  <button className="btn btn-secondary" disabled={processing} onClick={() => handlePeerSubmitNav(selected)}>
                    {t('approval.peer_submit')}
                  </button>
                </>
              )}
              {/* 일반 단계 액션 */}
              {actableStep && !isPLStep && (
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
