import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { documentsAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';
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
        {step.comment && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2, display: 'block', maxWidth: 120, wordBreak: 'break-all' }}>
            "{step.comment}"
          </span>
        )}
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

// ===== Table Components =====

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

// ===== PagedDetailView =====

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
    jayer = parsed?.jayerRows ?? [];
    oayer = parsed?.oayerRows ?? [];
    boneStew = parsed?.boneStewRows ?? [];
  } catch { /* noop */ }

  // PL은 모든 데이터 열람 가능
  const isPL = role === 'PL';
  const isR = role === 'TE_R' || role === 'MASTER' || isPL;
  const isJ = role === 'TE_J' || role === 'MASTER' || isPL;
  const isO = role === 'TE_O' || role === 'MASTER' || isPL;
  const isE = role === 'TE_E' || role === 'MASTER' || isPL;

  const showJayer = isR || isJ || isO;
  const showOayer = isO;
  const showBoneStew = isJ || isO;
  const showFlowChart = isJ || isO;

  // ===== 스타일 =====
  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '16px 20px',
    marginBottom: 16,
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)',
    marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: '1px solid var(--border)', paddingBottom: 8,
  };

  const fieldLabel: React.CSSProperties = {
    fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 3, fontWeight: 500,
  };

  const fieldValue: React.CSSProperties = {
    color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600,
    whiteSpace: 'pre-wrap', lineHeight: 1.5,
  };

  // 기본 칩 (기본 정보와 동일)
  const chipBase: React.CSSProperties = {
    flex: '1 1 0',
    minWidth: 100,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    textAlign: 'center' as const,
  };

  // 넓은 칩
  const chipWide: React.CSSProperties = {
    ...chipBase,
    flex: '2 1 0',
    minWidth: 180,
    textAlign: 'left' as const,
  };

  // 전체 너비 칩
  const chipFull: React.CSSProperties = {
    ...chipBase,
    flex: '1 1 100%',
    minWidth: 200,
    textAlign: 'left' as const,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8,
  };

  // ===== 칩 렌더 헬퍼 =====
  const Chip = ({ label, value, style }: { label: string; value: string | undefined | null; style?: React.CSSProperties }) => {
    if (!value) return null;
    const merged = { ...chipBase, ...style };
    return (
      <div style={merged}>
        <div style={{ ...fieldLabel, textAlign: merged.textAlign as any }}>{label}</div>
        <div style={{ ...fieldValue, textAlign: merged.textAlign as any }}>{value}</div>
      </div>
    );
  };

  // ===== 기본 정보 row =====
  const purposeValue = detail.request_purpose
    ? (detail.other_purpose ? `${detail.request_purpose}(${detail.other_purpose})` : detail.request_purpose)
    : '-';
  const basicRow = [
    { label: '요청목적', value: purposeValue },
    { label: '라인', value: detail.line || '-' },
    { label: '조합법', value: detail.combination_method || '-' },
    { label: '제품이름', value: detail.product_name_select || '-' },
    { label: '조리법', value: detail.cooking_method || '-' },
  ];

  // ===== C가문 서브필드 텍스트 =====
  const buildCFamilyInfo = (): string => {
    const lines: string[] = [];
    if (detail.c_family_north_line || detail.c_family_north_combination || detail.c_family_north_product) {
      lines.push(`[북] 라인: ${detail.c_family_north_line || '-'} / 조합: ${detail.c_family_north_combination || '-'} / 제품: ${detail.c_family_north_product || '-'}`);
    }
    const middleUse = detail.c_family_middle_use;
    if (middleUse) {
      if (middleUse === '미사용') {
        lines.push('[중간] 미사용');
      } else {
        lines.push(`[중간] 라인: ${detail.c_family_middle_line || '-'} / 조합: ${detail.c_family_middle_combination || '-'} / 제품: ${detail.c_family_middle_product || '-'}`);
      }
    }
    if (detail.c_family_south_line || detail.c_family_south_combination || detail.c_family_south_product) {
      lines.push(`[남] 라인: ${detail.c_family_south_line || '-'} / 조합: ${detail.c_family_south_combination || '-'} / 제품: ${detail.c_family_south_product || '-'}`);
    }
    return lines.join('\n');
  };

  const isCFamily = detail.only_c_family === 'Yes';
  const xMarkChange = detail.x_mark_change || '없음';
  const xMarkHasDetail = xMarkChange === '추가' || xMarkChange === '수정';
  const xMarkIsDelete = xMarkChange === '삭제';
  const isAnniversary = detail.anniversary_20 === 'Yes';

  // ===== PL 전용: 의뢰 기본 정보 카드 =====
  const PLBasicSection = isPL ? (
    <div style={cardStyle}>
      <div style={sectionTitle}>의뢰 기본 정보</div>
      <div style={rowStyle}>
        <Chip label="의뢰자" value={doc.requester_name} />
        <Chip label="부서" value={doc.requester_department} />
        <Chip label="직책" value={doc.requester_position} />
        <Chip label="이메일" value={doc.requester_email} style={chipWide} />
      </div>
      <div style={rowStyle}>
        <Chip label="제품명" value={doc.product_name} />
        <Chip label="제품유형" value={doc.product_type} />
        <Chip label="버전" value={doc.product_version} />
        <Chip label="기한" value={formatDate(doc.deadline)} />
      </div>
      {doc.product_description && (
        <div style={rowStyle}>
          <Chip label="제품 설명" value={doc.product_description} style={chipFull} />
        </div>
      )}
      {doc.key_features && (
        <div style={rowStyle}>
          <Chip label="주요 기능" value={doc.key_features} style={chipFull} />
        </div>
      )}
      {doc.changes_from_previous && (
        <div style={rowStyle}>
          <Chip label="이전 버전 대비 변경" value={doc.changes_from_previous} style={chipFull} />
        </div>
      )}
    </div>
  ) : null;

  type Page = { label: string; content: React.ReactNode };
  const pages: Page[] = [
    {
      label: '의뢰 상세',
      content: (
        <div>
          {PLBasicSection}

          {/* 기본 정보 */}
          <div style={cardStyle}>
            <div style={sectionTitle}>기본 정보</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {basicRow.map((item) => (
                <div key={item.label} style={chipBase}>
                  <div style={{ ...fieldLabel, textAlign: 'center' }}>{item.label}</div>
                  <div style={{ ...fieldValue }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 상세 정보 - 칩 스타일, 지정된 순서 */}
          <div style={cardStyle}>
            <div style={sectionTitle}>상세 정보</div>

            {/* 행 1: 원본 위치, 원본 제품 이름 */}
            {(isR || isJ) && (detail.source_location || detail.source_product_name) && (
              <div style={rowStyle}>
                <Chip label="원본 위치" value={detail.source_location} />
                <Chip label="원본 제품 이름" value={detail.source_product_name} />
              </div>
            )}

            {/* 행 2: 지도 편차 변경, 예외 구역 변경 */}
            {(isR || isO || isJ) && (detail.map_deviation_change || detail.exception_zone_change) && (
              <div style={rowStyle}>
                {(isR || isO) && detail.map_deviation_change && (
                  <div style={chipWide}>
                    <div style={{ ...fieldLabel, textAlign: 'left' }}>지도 편차 변경</div>
                    <div style={{ ...fieldValue, textAlign: 'left' }}>
                      {`변경: ${detail.map_deviation_change}${detail.map_deviation_value ? ` / 값: ${detail.map_deviation_value}` : ''}${detail.map_deviation_reason ? ` / 사유: ${detail.map_deviation_reason}` : ''}`}
                    </div>
                  </div>
                )}
                {isR && detail.exception_zone_change && (
                  <div style={chipWide}>
                    <div style={{ ...fieldLabel, textAlign: 'left' }}>예외 구역 변경</div>
                    <div style={{ ...fieldValue, textAlign: 'left' }}>
                      {`변경: ${detail.exception_zone_change}${detail.exception_zone_value ? ` / 값: ${detail.exception_zone_value}` : ''}`}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 행 3: X표시 변경 여부 + 서브필드 */}
            {isR && detail.x_mark_change && (
              <div style={rowStyle}>
                <Chip label="X표시 변경 여부" value={detail.x_mark_change} />
                {xMarkIsDelete && (
                  <div style={{ ...chipBase, border: '1px solid #f5c6cb', background: '#fff0f0' }}>
                    <div style={{ ...fieldLabel, color: '#dc3545' }}>삭제 안내</div>
                    <div style={{ ...fieldValue, color: '#dc3545' }}>특정 제품 삭제 필요</div>
                  </div>
                )}
                {xMarkHasDetail && detail.x_mark_image_copy && (
                  <Chip label="이미지 복사 위치" value={detail.x_mark_image_copy} style={chipWide} />
                )}
              </div>
            )}

            {/* 행 4: Only C가문 제품 + 서브필드 */}
            {isR && detail.only_c_family && (
              <div style={rowStyle}>
                <Chip label="Only C가문 제품" value={detail.only_c_family} />
                {isCFamily && buildCFamilyInfo() && (
                  <div style={chipFull}>
                    <div style={{ ...fieldLabel, textAlign: 'left' }}>C가문 세부 정보</div>
                    <div style={{ ...fieldValue, textAlign: 'left' }}>{buildCFamilyInfo()}</div>
                  </div>
                )}
              </div>
            )}

            {/* 행 5: 뼈찜 조합 영역 */}
            {(isJ || isO) && detail.bone_stew_zone && (
              <div style={rowStyle}>
                <div style={chipWide}>
                  <div style={{ ...fieldLabel, textAlign: 'left' }}>뼈찜 조합 영역</div>
                  <div style={{ ...fieldValue, textAlign: 'left' }}>
                    {`영역: ${detail.bone_stew_zone}${detail.bone_stew_location ? ` / 위치: ${detail.bone_stew_location}` : ''}${detail.bone_stew_product ? ` / 제품: ${detail.bone_stew_product}` : ''}${detail.bone_stew_cooking ? ` / 조리법: ${detail.bone_stew_cooking}` : ''}`}
                  </div>
                </div>
              </div>
            )}

            {/* 행 6: 분리 진행 여부, T가문 적용, 주력 제품 변경, 20주년 제품 */}
            {isR && (detail.separation_progress || detail.t_family_apply || detail.main_product_change || detail.anniversary_20) && (
              <div style={rowStyle}>
                <Chip label="분리 진행 여부" value={detail.separation_progress} />
                <Chip label="T가문 적용" value={detail.t_family_apply} />
                <Chip label="주력 제품 변경" value={detail.main_product_change} />
                <Chip label="20주년 제품" value={detail.anniversary_20} />
                {isAnniversary && detail.anniversary_20_option && (
                  <Chip label="20주년 옵션" value={detail.anniversary_20_option} />
                )}
              </div>
            )}

            {/* 행 7: 특이사항·변경 요청 목적 */}
            {((isO && !isR && !isJ) || role === 'MASTER' || isPL) && detail.change_purpose_note && (
              <div style={rowStyle}>
                <Chip label="특이사항·변경 요청 목적" value={detail.change_purpose_note} style={chipFull} />
              </div>
            )}

            {/* 설탕 추가 (E/MASTER 전용) */}
            {((isE && !isR && !isJ && !isO) || role === 'MASTER') && detail.sugar_add && (
              <div style={rowStyle}>
                <Chip label="설탕 추가 진행 여부" value={detail.sugar_add} />
              </div>
            )}
          </div>

          {/* 흐름도 */}
          {showFlowChart && (detail.flow_chart?.length ?? 0) > 0 && (
            <div style={cardStyle}>
              <div style={sectionTitle}>흐름도</div>
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
        <div style={cardStyle}>
          <div style={sectionTitle}>J-ayer 정보</div>
          <JayerTable rows={jayer} />
        </div>
      ),
    });
  }
  if (showOayer) {
    pages.push({
      label: 'O-ayer 정보',
      content: (
        <div style={cardStyle}>
          <div style={sectionTitle}>O-ayer 정보</div>
          <OayerTable rows={oayer} />
        </div>
      ),
    });
  }
  if (showBoneStew) {
    pages.push({
      label: '뼈찜 정보',
      content: (
        <div style={cardStyle}>
          <div style={sectionTitle}>뼈찜 정보</div>
          <BoneStewTable rows={boneStew} />
        </div>
      ),
    });
  }

  const safeIdx = Math.min(pageIdx, pages.length - 1);
  const currentPage = pages[safeIdx];

  const navBtnStyle = (disabled: boolean): React.CSSProperties => ({
    background: disabled ? 'var(--bg-secondary)' : 'var(--accent)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 16px',
    cursor: disabled ? 'default' : 'pointer',
    color: disabled ? 'var(--text-muted)' : '#fff',
    fontSize: '1rem',
    fontWeight: 600,
    transition: 'opacity 0.15s',
  });

  return (
    <div>
      {pages.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: '10px 16px' }}>
          <button style={navBtnStyle(safeIdx === 0)} disabled={safeIdx === 0} onClick={() => setPageIdx(safeIdx - 1)}>◀</button>
          <span style={{ flex: 1, textAlign: 'center', fontWeight: 700, color: 'var(--accent)', fontSize: '1rem' }}>
            {currentPage.label} ({safeIdx + 1} / {pages.length})
          </span>
          <button style={navBtnStyle(safeIdx === pages.length - 1)} disabled={safeIdx === pages.length - 1} onClick={() => setPageIdx(safeIdx + 1)}>▶</button>
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

  // 합의/반려 comment 모달
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: 'agree' | 'reject'; agent: AgentType } | null>(null);
  const [commentInput, setCommentInput] = useState('');

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
        addToast(`AGENT ${pendingAction.agent} 합의 처리되었습니다.`, 'success');
        setModalOpen(false);
        fetchDocs();
      } else {
        await documentsAPI.rejectStep(selected.id, pendingAction.agent, commentInput || undefined);
        addToast('반려 처리되었습니다.', 'error');
        await refreshAndSelect(selected.id);
      }
    } catch {
      addToast('처리 중 오류가 발생했습니다.', 'error');
    } finally {
      setProcessing(false);
      setPendingAction(null);
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

      {/* 합의/반려 이유 입력 모달 */}
      {commentModalOpen && pendingAction && (
        <Modal
          isOpen={commentModalOpen}
          onClose={() => { setCommentModalOpen(false); setPendingAction(null); }}
          title={pendingAction.type === 'agree' ? `AGENT ${pendingAction.agent} 합의` : `AGENT ${pendingAction.agent} 반려`}
          size="md"
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className={pendingAction.type === 'agree' ? 'btn btn-primary' : 'btn btn-danger'}
                onClick={handleConfirmAction}
                disabled={processing}
              >
                확인
              </button>
              <button className="btn btn-secondary" onClick={() => { setCommentModalOpen(false); setPendingAction(null); }}>
                취소
              </button>
            </div>
          }
        >
          <div>
            <p style={{ marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              {pendingAction.type === 'agree' ? '합의 이유 (선택)' : '반려 이유 (선택)'}
            </p>
            <textarea
              className="form-control"
              rows={4}
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              placeholder={pendingAction.type === 'agree' ? '합의 이유를 입력하세요...' : '반려 이유를 입력하세요...'}
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
          const pendingStep = selected?.approval_steps?.find((s) =>
            s.action === 'pending' && (isMaster ? true : s.agent === userAgent)
          );
          const canAct = !!pendingStep && selected?.status === 'under_review';
          return (
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
              {canAct && pendingStep && (
                <>
                  <button
                    className="btn btn-primary"
                    disabled={processing}
                    onClick={() => triggerAgree(pendingStep.agent)}
                  >
                    합의
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={processing}
                    onClick={() => triggerReject(pendingStep.agent)}
                  >
                    반려
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
              현재 역할: {ROLE_LABEL[currentUser.role]} ({currentUser.name})
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
                      <span style={{ fontWeight: 700 }}>AGENT {s.agent} ({s.action === 'approved' ? '합의' : '반려'})</span>: {s.comment}
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
