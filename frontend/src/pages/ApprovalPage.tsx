import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { documentsAPI } from '../api/client';
import StatusBadge, { PriorityBadge } from '../components/StatusBadge';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { RequestDocument, AgentType, ApprovalStepFrontend } from '../types';

interface FilterTab {
  key: string;
  label: string;
}

const formatDate = (d: string | null): string => (d ? new Date(d).toLocaleDateString('ko-KR') : '-');

// 현재 결재 대기 단계 표시
const getCurrentStage = (doc: RequestDocument): string => {
  const steps = doc.approval_steps ?? [];
  const pending = steps.filter((s) => s.action === 'pending');
  if (pending.length === 0 && doc.status === 'approved') return '결재완료';
  if (pending.length === 0) return '-';
  return pending.map((s) => `AGENT ${s.agent}`).join(' / ');
};

// ===== Approval Flow Component =====

interface ApprovalFlowProps {
  doc: RequestDocument;
  onApprove: (agent: AgentType) => void;
  approving: boolean;
}

function ApprovalFlow({ doc, onApprove, approving }: ApprovalFlowProps): React.ReactElement {
  const steps = doc.approval_steps ?? [];

  const getStep = (agent: AgentType): ApprovalStepFrontend | undefined =>
    steps.find((s) => s.agent === agent);

  const rStep = getStep('R');
  const jStep = getStep('J');
  const oStep = getStep('O');
  const eStep = getStep('E');

  // 설탕 추가 여부 판단
  let sugarAdd = false;
  try {
    const parsed = JSON.parse(doc.additional_notes ?? '{}');
    sugarAdd = parsed?.detail?.sugar_add === '예';
  } catch {
    sugarAdd = false;
  }

  const renderStepBadge = (step: ApprovalStepFrontend | undefined, label: string) => {
    if (!step) {
      return (
        <div className="approval-node approval-node-inactive">
          <span className="step-agent-label">{label}</span>
          <span className="step-badge step-badge-future">대기예정</span>
        </div>
      );
    }
    return (
      <div className={`approval-node ${step.action === 'approved' ? 'approval-node-done' : step.action === 'rejected' ? 'approval-node-rejected' : ''}`}>
        <span className="step-agent-label">{label}</span>
        <span className={`step-badge step-badge-${step.action}`}>
          {step.action === 'approved' ? '✓ 승인' : step.action === 'rejected' ? '✗ 반려' : '대기중'}
        </span>
        {step.acted_at && (
          <span className="step-acted-at">{formatDate(step.acted_at)}</span>
        )}
        {step.action === 'pending' && (
          <button
            className="btn btn-primary btn-sm"
            style={{ marginTop: 6 }}
            disabled={approving}
            onClick={() => onApprove(step.agent)}
          >
            승인
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="approval-flow">
      {/* 상신됨 */}
      <div className="approval-node approval-node-start">
        <span className="step-agent-label">상신됨</span>
        <span className="step-badge step-badge-approved">✓</span>
        {doc.submitted_at && <span className="step-acted-at">{formatDate(doc.submitted_at)}</span>}
      </div>

      <div className="approval-connector" />

      {/* AGENT R */}
      {renderStepBadge(rStep, 'AGENT R')}

      <div className="approval-connector" />

      {/* AGENT J + O 병렬 */}
      <div className="approval-parallel">
        {renderStepBadge(jStep, 'AGENT J')}
        {renderStepBadge(oStep, 'AGENT O')}
      </div>

      <div className="approval-connector" />

      {/* AGENT E (설탕추가=예 또는 이미 스텝이 있는 경우) */}
      {(sugarAdd || eStep) && (
        <>
          {renderStepBadge(eStep, 'AGENT E')}
          <div className="approval-connector" />
        </>
      )}

      {/* 결재완료 */}
      <div className={`approval-node ${doc.status === 'approved' ? 'approval-node-done' : 'approval-node-inactive'}`}>
        <span className="step-agent-label">결재완료</span>
        {doc.status === 'approved' && <span className="step-badge step-badge-approved">✓ 완료</span>}
      </div>
    </div>
  );
}

// ===== Main Page =====

export default function ApprovalPage(): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();
  const [docs, setDocs] = useState<RequestDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RequestDocument | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  const fetchDocs = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (filter) params.status = filter;
    if (search) params.search = search;
    documentsAPI
      .list(params)
      .then((r) => {
        const data = r.data;
        setDocs(Array.isArray(data) ? data : (data as any).results ?? []);
      })
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [filter, search]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const filterTabs: FilterTab[] = [
    { key: '', label: t('approval.filter_all') },
    { key: 'submitted', label: t('approval.filter_submitted') },
    { key: 'under_review', label: t('approval.filter_under_review') },
    { key: 'approved', label: t('approval.filter_approved') },
    { key: 'rejected', label: t('approval.filter_rejected') },
  ];

  const openDetail = (doc: RequestDocument) => {
    setSelected(doc);
    setModalOpen(true);
  };

  const handleApproveStep = async (agent: AgentType) => {
    if (!selected) return;
    setApproving(true);
    try {
      await documentsAPI.approveStep(selected.id, agent);
      addToast(`AGENT ${agent} 승인 처리되었습니다.`, 'success');
      // 목록 갱신 후 선택 문서 업데이트
      const listResult = await documentsAPI.list({});
      const listData = listResult.data;
      const newDocs: RequestDocument[] = Array.isArray(listData)
        ? listData
        : (listData as any).results ?? [];
      setDocs(newDocs);
      const refreshed = newDocs.find((d) => d.id === selected.id);
      if (refreshed) setSelected(refreshed);
    } catch {
      addToast('처리 중 오류가 발생했습니다.', 'error');
    } finally {
      setApproving(false);
    }
  };

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
        <div className="empty-state">
          <p>{t('common.loading')}</p>
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
                <th>{t('approval.col_status')}</th>
                <th>현재 단계</th>
                <th>{t('approval.col_priority')}</th>
                <th>{t('approval.col_submitted')}</th>
                <th>{t('approval.col_deadline')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{doc.title}</td>
                  <td>{doc.product_name}</td>
                  <td>
                    <div>{doc.requester_name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {doc.requester_department}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={doc.status} />
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 500 }}>
                    {getCurrentStage(doc)}
                  </td>
                  <td>
                    <PriorityBadge priority={doc.priority} />
                  </td>
                  <td>{formatDate(doc.submitted_at)}</td>
                  <td>{formatDate(doc.deadline)}</td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => openDetail(doc)}>
                      {t('approval.view_detail')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={selected?.title ?? ''}
        footer={
          <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>
            {t('common.close')}
          </button>
        }
      >
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <StatusBadge status={selected.status} />
              <PriorityBadge priority={selected.priority} />
            </div>

            {/* 결재 경로 */}
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                결재 경로
              </div>
              <ApprovalFlow
                doc={selected}
                onApprove={handleApproveStep}
                approving={approving}
              />
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }} />

            {(
              [
                [t('approval.col_product'), selected.product_name],
                [
                  t('approval.col_requester'),
                  `${selected.requester_name} (${selected.requester_department})`,
                ],
                [t('approval.col_submitted'), formatDate(selected.submitted_at)],
                [t('approval.col_deadline'), formatDate(selected.deadline)],
              ] as [string, string][]
            ).map(([label, val]) => (
              <div key={label} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  {label}
                </div>
                <div style={{ color: 'var(--text-primary)' }}>{val}</div>
              </div>
            ))}
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                제품 설명
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
                {selected.product_description}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
