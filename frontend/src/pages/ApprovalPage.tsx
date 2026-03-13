import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { documentsAPI } from '../api/client';
import StatusBadge, { PriorityBadge } from '../components/StatusBadge';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { useAuth, ROLE_LABEL } from '../contexts/AuthContext';
import { RequestDocument, AgentType, ApprovalStepFrontend, UserRole, DetailFormState, FlowChartRow, JayerRow, OayerRow, BoneStewTableRow } from '../types';

// ===== Utils =====

const formatDate = (d: string | null): string => (d ? new Date(d).toLocaleDateString('ko-KR') : '-');

const getCurrentStage = (doc: RequestDocument): string => {
  const steps = doc.approval_steps ?? [];
  const pending = steps.filter((s) => s.action === 'pending');
  if (pending.length === 0 && doc.status === 'approved') return '결재완료';
  if (pending.length === 0) return '-';
  return pending.map((s) => `AGENT ${s.agent}`).join(' / ');
};

// 역할 → 합의 가능한 AgentType 매핑
const ROLE_TO_AGENT: Partial<Record<UserRole, AgentType>> = {
  TE_R: 'R',
  TE_J: 'J',
  TE_O: 'O',
  TE_E: 'E',
};

const canUserAgree = (role: UserRole, step: ApprovalStepFrontend): boolean => {
  if (role === 'MASTER') return true;
  const agent = ROLE_TO_AGENT[role];
  return !!agent && step.agent === agent && step.action === 'pending';
};

// ===== Approval Flow Component =====

interface ApprovalFlowProps {
  doc: RequestDocument;
  onAgree: (agent: AgentType) => void;
  onReject: (agent: AgentType) => void;
  processing: boolean;
  userRole: UserRole;
}

function ApprovalFlow({ doc, onAgree, onReject, processing, userRole }: ApprovalFlowProps): React.ReactElement {
  const steps = doc.approval_steps ?? [];

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
          <span className="step-badge step-badge-future">대기예정</span>
        </div>
      );
    }
    const canAct = canUserAgree(userRole, step);
    return (
      <div className={`approval-node ${step.action === 'approved' ? 'approval-node-done' : step.action === 'rejected' ? 'approval-node-rejected' : ''}`}>
        <span className="step-agent-label">{label}</span>
        <span className={`step-badge step-badge-${step.action}`}>
          {step.action === 'approved' ? '✓ 합의' : step.action === 'rejected' ? '✗ 반려' : '대기중'}
        </span>
        {step.acted_at && <span className="step-acted-at">{formatDate(step.acted_at)}</span>}
        {step.action === 'pending' && canAct && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={processing}
              onClick={() => onAgree(step.agent)}
            >
              합의
            </button>
            <button
              className="btn btn-danger btn-sm"
              disabled={processing}
              onClick={() => onReject(step.agent)}
            >
              반려
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="approval-flow">
      <div className="approval-node approval-node-start">
        <span className="step-agent-label">상신됨</span>
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
        <span className="step-agent-label">결재완료</span>
        {doc.status === 'approved' && <span className="step-badge step-badge-approved">✓ 완료</span>}
      </div>
    </div>
  );
}

// ===== Team-specific Detail View =====

interface DetailField {
  label: string;
  value: string | null | undefined;
  show: boolean;
}

function DetailSection({ title, fields }: { title: string; fields: DetailField[] }) {
  const visible = fields.filter((f) => f.show && f.value);
  if (visible.length === 0) return null;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
        {title}
      </div>
      {visible.map((f) => (
        <div key={f.label} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>{f.label}</div>
          <div style={{ color: 'var(--text-primary)', fontSize: '0.875rem', whiteSpace: 'pre-wrap' }}>{f.value}</div>
        </div>
      ))}
    </div>
  );
}

function FlowChartTable({ rows }: { rows: FlowChartRow[] }) {
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>데이터 없음</div>;
  return (
    <table className="table" style={{ fontSize: '0.8rem', marginBottom: 8 }}>
      <thead><tr><th>위치</th><th>제품 이름</th><th>Step</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}><td>{r.location}</td><td>{r.product_name}</td><td>{r.step}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function JayerTable({ rows }: { rows: JayerRow[] }) {
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>데이터 없음</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
        <thead><tr><th>조리법</th><th>SP</th><th>SD</th><th>PP</th><th>ST</th><th>신규/복사</th><th>제품명</th><th>Step</th><th>Item ID</th><th>REV</th><th>도면버전</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}><td>{r.cooking_method}</td><td>{r.sp}</td><td>{r.sd}</td><td>{r.pp}</td><td>{r.st}</td><td>{r.new_or_copy}</td><td>{r.product_name}</td><td>{r.step}</td><td>{r.item_id}</td><td>{r.rev}</td><td>{r.drawing_version}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OayerTable({ rows }: { rows: OayerRow[] }) {
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>데이터 없음</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
        <thead><tr><th>조리법</th><th>SP</th><th>SD</th><th>PP</th><th>ST</th><th>신규/복사</th><th>제품명</th><th>Step</th><th>TT</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}><td>{r.cooking_method}</td><td>{r.sp}</td><td>{r.sd}</td><td>{r.pp}</td><td>{r.st}</td><td>{r.new_or_copy}</td><td>{r.product_name}</td><td>{r.step}</td><td>{r.tt}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoneStewTable({ rows }: { rows: BoneStewTableRow[] }) {
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>데이터 없음</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
        <thead><tr><th>조리법</th><th>SS</th><th>SD</th><th>뼈조리법</th><th>뼈이름</th><th>뼈Step</th><th>뼈SS</th><th>비고</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}><td>{r.cooking_method}</td><td>{r.ss}</td><td>{r.sd}</td><td>{r.bone_cooking}</td><td>{r.bone_name}</td><td>{r.bone_step}</td><td>{r.bone_ss}</td><td>{r.remark}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SECTION_TITLE_STYLE: React.CSSProperties = {
  fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent)', marginBottom: 10,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  borderBottom: '1px solid var(--border)', paddingBottom: 6,
};

interface PagedDetailViewProps {
  doc: RequestDocument;
  role: UserRole;
  pageIdx: number;
  setPageIdx: (idx: number) => void;
}

function PagedDetailView({ doc, role, pageIdx, setPageIdx }: PagedDetailViewProps): React.ReactElement {
  let detail: Partial<DetailFormState> = {};
  let jayer: JayerRow[] = [];
  let oayer: OayerRow[] = [];
  let boneStew: BoneStewTableRow[] = [];

  try {
    const parsed = JSON.parse(doc.additional_notes ?? '{}');
    detail = parsed?.detail ?? {};
    jayer = parsed?.jayer ?? [];
    oayer = parsed?.oayer ?? [];
    boneStew = parsed?.bone_stew ?? [];
  } catch { /* noop */ }

  const isR = role === 'TE_R' || role === 'MASTER';
  const isJ = role === 'TE_J' || role === 'MASTER';
  const isO = role === 'TE_O' || role === 'MASTER';
  const isE = role === 'TE_E' || role === 'MASTER';

  const showJayer = isR || isJ || isO;
  const showOayer = isO;
  const showBoneStew = isJ || isO;
  const showFlowChart = isJ || isO;

  const basicFields: DetailField[] = [
    { label: '조합법', value: detail.combination_method, show: true },
    { label: '제품 이름', value: detail.product_name_select, show: true },
    { label: '조리법', value: detail.cooking_method, show: true },
    { label: '라인', value: detail.line, show: true },
    { label: '요청 목적', value: detail.request_purpose, show: true },
  ];

  const detailFields: DetailField[] = [
    { label: '특이사항·변경 요청 목적', value: detail.change_purpose_note, show: (isO && !isR && !isJ) || role === 'MASTER' },
    { label: '지도 편차 변경', value: detail.map_deviation_change ? `변경: ${detail.map_deviation_change} / 값: ${detail.map_deviation_value ?? ''} / 사유: ${detail.map_deviation_reason ?? ''}` : undefined, show: isR || isO },
    { label: '예외 구역 변경', value: detail.exception_zone_change ? `변경: ${detail.exception_zone_change} / 값: ${detail.exception_zone_value ?? ''}` : undefined, show: isR },
    { label: '분리 진행 여부', value: detail.separation_progress, show: isR },
    { label: '뼈찜 조합 영역', value: detail.bone_stew_zone ? `영역: ${detail.bone_stew_zone} / 위치: ${detail.bone_stew_location ?? ''} / 제품: ${detail.bone_stew_product ?? ''} / 조리법: ${detail.bone_stew_cooking ?? ''}` : undefined, show: isJ || isO },
    { label: 'Only C가문 제품', value: detail.only_c_family, show: isR },
    { label: '기타 목적', value: detail.other_purpose, show: isR || isJ },
    { label: '원본 위치', value: detail.source_location, show: isR || isJ },
    { label: '원본 제품 이름', value: detail.source_product_name, show: isR || isJ },
    { label: 'X표시 변경 여부', value: detail.x_mark_change, show: isR },
    { label: '20주년 제품', value: detail.anniversary_20, show: isR },
    { label: 'T가문 적용', value: detail.t_family_apply, show: isR },
    { label: '주력 제품 변경', value: detail.main_product_change, show: isR },
    { label: '설탕 추가 진행 여부', value: detail.sugar_add, show: (isE && !isR && !isJ && !isO) || role === 'MASTER' },
  ];

  type Page = { label: string; content: React.ReactNode };
  const pages: Page[] = [
    {
      label: '의뢰 상세',
      content: (
        <div>
          <DetailSection title="기본 정보" fields={basicFields} />
          <DetailSection title="상세 정보" fields={detailFields} />
          {showFlowChart && (detail.flow_chart?.length ?? 0) > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={SECTION_TITLE_STYLE}>흐름도</div>
              <FlowChartTable rows={detail.flow_chart ?? []} />
            </div>
          )}
        </div>
      ),
    },
  ];

  if (showJayer) {
    pages.push({
      label: 'J-ayer 정보',
      content: (
        <div style={{ marginBottom: 20 }}>
          <div style={SECTION_TITLE_STYLE}>J-ayer 정보</div>
          <JayerTable rows={jayer} />
        </div>
      ),
    });
  }
  if (showOayer) {
    pages.push({
      label: 'O-ayer 정보',
      content: (
        <div style={{ marginBottom: 20 }}>
          <div style={SECTION_TITLE_STYLE}>O-ayer 정보</div>
          <OayerTable rows={oayer} />
        </div>
      ),
    });
  }
  if (showBoneStew) {
    pages.push({
      label: '뼈찜 정보',
      content: (
        <div style={{ marginBottom: 20 }}>
          <div style={SECTION_TITLE_STYLE}>뼈찜 정보</div>
          <BoneStewTable rows={boneStew} />
        </div>
      ),
    });
  }

  const safeIdx = Math.min(pageIdx, pages.length - 1);
  const currentPage = pages[safeIdx];

  const navBtnStyle = (disabled: boolean): React.CSSProperties => ({
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '4px 14px',
    cursor: disabled ? 'default' : 'pointer',
    color: 'var(--text-primary)',
    fontSize: '1rem',
    opacity: disabled ? 0.3 : 1,
  });

  return (
    <div>
      {pages.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          <button
            style={navBtnStyle(safeIdx === 0)}
            disabled={safeIdx === 0}
            onClick={() => setPageIdx(safeIdx - 1)}
          >◀</button>
          <span style={{ flex: 1, textAlign: 'center', fontWeight: 600, color: 'var(--accent)', fontSize: '0.95rem' }}>
            {currentPage.label} ({safeIdx + 1} / {pages.length})
          </span>
          <button
            style={navBtnStyle(safeIdx === pages.length - 1)}
            disabled={safeIdx === pages.length - 1}
            onClick={() => setPageIdx(safeIdx + 1)}
          >▶</button>
        </div>
      )}
      {currentPage.content}
    </div>
  );
}

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

  const handleAgree = async (agent: AgentType) => {
    if (!selected) return;
    setProcessing(true);
    try {
      await documentsAPI.approveStep(selected.id, agent);
      addToast(`AGENT ${agent} 합의 처리되었습니다.`, 'success');
      await refreshAndSelect(selected.id);
    } catch {
      addToast('처리 중 오류가 발생했습니다.', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async (agent: AgentType) => {
    if (!selected) return;
    if (!window.confirm(`AGENT ${agent} 단계를 반려하시겠습니까?`)) return;
    setProcessing(true);
    try {
      await documentsAPI.rejectStep(selected.id, agent);
      addToast(`반려 처리되었습니다.`, 'error');
      await refreshAndSelect(selected.id);
    } catch {
      addToast('처리 중 오류가 발생했습니다.', 'error');
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
      addToast('처리 중 오류가 발생했습니다.', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleEditResubmit = (doc: RequestDocument) => {
    setModalOpen(false);
    navigate('/request', { state: { editDocId: doc.id } });
  };

  // PL은 자신의 문서만 철회/재상신 가능 (샘플데이터는 모두 허용, 실 서버에서는 requester 체크)
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
                <th>{t('approval.col_priority')}</th>
                <th>{t('approval.col_submitted')}</th>
                <th>{t('approval.col_deadline')}</th>
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
                    {getCurrentStage(doc)}
                  </td>
                  <td><PriorityBadge priority={doc.priority} /></td>
                  <td>{formatDate(doc.submitted_at)}</td>
                  <td>{formatDate(doc.deadline)}</td>
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

      {/* Detail Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={selected?.title ?? ''}
        size="lg"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
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
            <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>
              {t('common.close')}
            </button>
          </div>
        }
      >
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 현재 역할 표시 */}
            <div style={{ background: 'var(--accent-light)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600 }}>
              현재 역할: {ROLE_LABEL[currentUser.role]} ({currentUser.name})
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <StatusBadge status={selected.status} />
              <PriorityBadge priority={selected.priority} />
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
