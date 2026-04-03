import React from 'react';
import { useTranslation } from 'react-i18next';
import { RequestDocument, UserRole, DetailFormState, FlowChartRow, JayerRow, OayerRow, BoneStewTableRow } from '../types';

// ===== Table Components =====

function FlowChartTable({ rows }: { rows: FlowChartRow[] }) {
  const { t } = useTranslation();
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('common.no_data')}</div>;
  return (
    <table className="table" style={{ fontSize: '0.8rem', marginBottom: 8 }}>
      <thead><tr><th>{t('request.flow_line')}</th><th>{t('request.flow_partid')}</th><th>Step</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}><td>{r.location}</td><td>{r.product_name}</td><td>{r.step}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function JayerTable({ rows }: { rows: JayerRow[] }) {
  const { t } = useTranslation();
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('common.no_data')}</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
        <thead><tr><th>{t('request.method')}</th><th>SP</th><th>SD</th><th>PP</th><th>ST</th><th>신규/복사</th><th>제품 이름</th><th>STEP</th><th>ID</th><th>REV 여부</th><th>그림판 version</th></tr></thead>
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
  const { t } = useTranslation();
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('common.no_data')}</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
        <thead><tr><th>{t('request.method')}</th><th>SP</th><th>SD</th><th>PP</th><th>ST</th><th>신규/복사</th><th>제품 이름</th><th>STEP</th><th>TT</th></tr></thead>
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
  const { t } = useTranslation();
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('common.no_data')}</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
        <thead><tr><th>조리법</th><th>SS</th><th>SD</th><th>뼈찜 조리법</th><th>뼈찜 이름</th><th>뼈찜 STEP</th><th>뼈찜 SS</th><th>비고</th></tr></thead>
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

export interface PagedDetailViewProps {
  doc: RequestDocument;
  role: UserRole;
  pageIdx: number;
  setPageIdx: (idx: number) => void;
}

export default function PagedDetailView({ doc, role, pageIdx, setPageIdx }: PagedDetailViewProps): React.ReactElement {
  const { t } = useTranslation();
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

  const isPL = role === 'PL';
  const isR = role === 'TE_R' || role === 'MASTER' || isPL;
  const isJ = role === 'TE_J' || role === 'MASTER' || isPL;
  const isO = role === 'TE_O' || role === 'MASTER' || isPL;
  const isE = role === 'TE_E' || role === 'MASTER' || isPL;

  const showJayer = isR || isJ || isO;
  const showOayer = isO;
  const showBoneStew = isJ || isO;
  const showFlowChart = isJ || isO;

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

  const chipBase: React.CSSProperties = {
    flex: '1 1 0',
    minWidth: 100,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    textAlign: 'center' as const,
  };

  const chipWide: React.CSSProperties = {
    ...chipBase,
    flex: '2 1 0',
    minWidth: 180,
    textAlign: 'left' as const,
  };

  const chipFull: React.CSSProperties = {
    ...chipBase,
    flex: '1 1 100%',
    minWidth: 200,
    textAlign: 'left' as const,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8,
  };

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

  const purposeValue = detail.request_purpose
    ? (detail.other_purpose ? `${detail.request_purpose}(${detail.other_purpose})` : detail.request_purpose)
    : '-';
  const basicRow = [
    { label: t('request.request_purpose'), value: purposeValue },
    { label: t('request.line'), value: detail.line || '-' },
    { label: t('request.process_selection'), value: detail.combination_method || '-' },
    { label: t('request.partid_selection'), value: detail.product_name_select || '-' },
    { label: t('request.method'), value: detail.cooking_method || '-' },
  ];

  const buildCFamilyInfo = (): string => {
    const lines: string[] = [];
    if (detail.c_family_north_line || detail.c_family_north_combination || detail.c_family_north_product) {
      lines.push(`[북] ${detail.c_family_north_line || '-'} / ${detail.c_family_north_combination || '-'} / ${detail.c_family_north_product || '-'}`);
    }
    const middleUse = detail.c_family_middle_use;
    if (middleUse) {
      if (middleUse === '미사용') {
        lines.push('[중간] 미사용');
      } else {
        lines.push(`[중간] ${detail.c_family_middle_line || '-'} / ${detail.c_family_middle_combination || '-'} / ${detail.c_family_middle_product || '-'}`);
      }
    }
    if (detail.c_family_south_line || detail.c_family_south_combination || detail.c_family_south_product) {
      lines.push(`[남] ${detail.c_family_south_line || '-'} / ${detail.c_family_south_combination || '-'} / ${detail.c_family_south_product || '-'}`);
    }
    return lines.join('\n');
  };

  const isCFamily = detail.only_c_family === 'Yes';
  const xMarkChange = detail.x_mark_change || '없음';
  const xMarkHasDetail = xMarkChange === '추가' || xMarkChange === '수정';
  const xMarkIsDelete = xMarkChange === '삭제';
  const isAnniversary = detail.anniversary_20 === 'Yes';

  const PLBasicSection = null;

type Page = { label: string; content: React.ReactNode };
  const pages: Page[] = [
    {
      label: t('request.section_detail'),
      content: (
        <div>
          {PLBasicSection}

          <div style={cardStyle}>
            <div style={sectionTitle}>{t('approval.section_basic')}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {basicRow.map((item) => (
                <div key={item.label} style={chipBase}>
                  <div style={{ ...fieldLabel, textAlign: 'center' }}>{item.label}</div>
                  <div style={{ ...fieldValue }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={sectionTitle}>{t('approval.section_detail')}</div>

            {(isR || isJ) && (detail.source_location || detail.source_product_name) && (
              <div style={rowStyle}>
                <Chip label={t('request.source_line')} value={detail.source_location} />
                <Chip label={t('request.source_partid_selection')} value={detail.source_product_name} />
              </div>
            )}

            {(isR || isO || isJ) && (detail.map_deviation_change || detail.exception_zone_change) && (
              <div style={rowStyle}>
                {(isR || isO) && detail.map_deviation_change && (
                  <div style={chipWide}>
                    <div style={{ ...fieldLabel, textAlign: 'left' }}>{t('request.map')}</div>
                    <div style={{ ...fieldValue, textAlign: 'left' }}>
                      {`변경: ${detail.map_deviation_change}${detail.map_deviation_value_x ? ` / X: ${detail.map_deviation_value_x}` : ''}${detail.map_deviation_value_y ? ` / Y: ${detail.map_deviation_value_y}` : ''}${detail.map_deviation_reason ? ` / 사유: ${detail.map_deviation_reason}` : ''}`}
                    </div>
                  </div>
                )}
                {isR && detail.exception_zone_change && (
                  <div style={chipWide}>
                    <div style={{ ...fieldLabel, textAlign: 'left' }}>{t('request.ea_change')}</div>
                    <div style={{ ...fieldValue, textAlign: 'left' }}>
                      {`변경: ${detail.exception_zone_change}${detail.exception_zone_value ? ` / 값: ${detail.exception_zone_value}` : ''}`}
                    </div>
                  </div>
                )}
              </div>
            )}

            {isR && detail.x_mark_change && (
              <div style={rowStyle}>
                <div style={{ ...chipBase, display: 'flex', gap: 0, textAlign: 'left', flex: '1 1 auto', minWidth: 200 }}>
                  <div style={{ flex: '0 0 auto', paddingRight: 12, borderRight: '1px solid var(--border)', marginRight: 12 }}>
                    <div style={fieldLabel}>{t('request.mshot_change_status')}</div>
                    <div style={fieldValue}>{detail.x_mark_change}</div>
                  </div>
                  {xMarkIsDelete && (
                    <div style={{ flex: 1 }}>
                      <div style={{ ...fieldLabel, color: '#dc3545' }}>{t('approval.x_mark_delete_notice')}</div>
                      <div style={{ ...fieldValue, color: '#dc3545' }}>{t('approval.x_mark_delete_desc')}</div>
                    </div>
                  )}
                  {xMarkHasDetail && detail.x_mark_image_copy && (
                    <div style={{ flex: 1 }}>
                      <div style={fieldLabel}>{t('request.mshot_change_image_attach_area')}</div>
                      <div style={fieldValue}>{detail.x_mark_image_copy}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {isR && detail.only_c_family && (
              <div style={rowStyle}>
                <div style={{ ...chipBase, display: 'flex', gap: 0, textAlign: 'left', flex: '1 1 auto', minWidth: 200 }}>
                  <div style={{ flex: '0 0 auto', paddingRight: 12, borderRight: '1px solid var(--border)', marginRight: 12 }}>
                    <div style={fieldLabel}>{t('request.prodc_status')}</div>
                    <div style={fieldValue}>{detail.only_c_family}</div>
                  </div>
                  {isCFamily && buildCFamilyInfo() && (
                    <div style={{ flex: 1 }}>
                      <div style={fieldLabel}>{t('approval.c_family_detail')}</div>
                      <div style={{ ...fieldValue, whiteSpace: 'pre-line' }}>{buildCFamilyInfo()}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {(isJ || isO) && detail.bone_stew_zone && (
              <div style={rowStyle}>
                <div style={chipWide}>
                  <div style={{ ...fieldLabel, textAlign: 'left' }}>{t('request.bb_status')}</div>
                  <div style={{ ...fieldValue, textAlign: 'left' }}>
                    {`영역: ${detail.bone_stew_zone}`}
                    {Array.isArray(detail.bone_stew_entries) && detail.bone_stew_entries.length > 0 && (
                      <span>
                        {detail.bone_stew_entries.map((e: { location: string; product: string; cooking: string }, i: number) =>
                          ` / [${i + 1}] 위치: ${e.location || '-'} / 제품: ${e.product || '-'} / 조리법: ${e.cooking || '-'}`
                        ).join('')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {isR && (detail.separation_progress || detail.t_family_apply || detail.main_product_change || detail.anniversary_20) && (
              <div style={rowStyle}>
                <Chip label={t('request.split_progress_status')} value={detail.separation_progress} />
                <Chip label={t('request.tmap_application_status')} value={detail.t_family_apply} />
                <Chip label={t('request.hplhc_status')} value={detail.main_product_change} />
                <Chip label={t('request.ip_application_status')} value={detail.anniversary_20} />
                {isAnniversary && detail.anniversary_20_option && (
                  <Chip label={t('request.ip_option_selection')} value={detail.anniversary_20_option} />
                )}
              </div>
            )}

            {((isO && !isR && !isJ) || role === 'MASTER' || isPL) && detail.change_purpose_note && (
              <div style={rowStyle}>
                <Chip label={t('request.change_purpose_note')} value={detail.change_purpose_note} style={chipFull} />
              </div>
            )}

            {((isE && !isR && !isJ && !isO) || role === 'MASTER') && detail.sugar_add && (
              <div style={rowStyle}>
                <Chip label={t('request.e_lps')} value={detail.sugar_add} />
              </div>
            )}
          </div>

          {showFlowChart && (detail.flow_chart?.length ?? 0) > 0 && (
            <div style={cardStyle}>
              <div style={sectionTitle}>{t('request.flow_chart')}</div>
              <FlowChartTable rows={detail.flow_chart ?? []} />
            </div>
          )}

          {doc.reference_materials && (
            <div style={cardStyle}>
              <div style={sectionTitle}>특이사항</div>
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {doc.reference_materials}
              </div>
            </div>
          )}
        </div>
      ),
    },
  ];

  if (showJayer) {
    pages.push({
      label: t('request.job_li'),
      content: (
        <div style={cardStyle}>
          <div style={sectionTitle}>{t('request.job_li')}</div>
          <JayerTable rows={jayer} />
        </div>
      ),
    });
  }
  if (showOayer) {
    pages.push({
      label: t('request.ovl_li'),
      content: (
        <div style={cardStyle}>
          <div style={sectionTitle}>{t('request.ovl_li')}</div>
          <OayerTable rows={oayer} />
        </div>
      ),
    });
  }
  if (showBoneStew) {
    pages.push({
      label: t('request.bb_li'),
      content: (
        <div style={cardStyle}>
          <div style={sectionTitle}>{t('request.bb_li')}</div>
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
