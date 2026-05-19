import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RequestDocument, UserRole, DetailFormState, FlowChartRow, JayerRow, OayerRow, BbTableRow, HistorySnapshot } from '../types';
import Modal from './Modal';

// ===== Table Components =====

function FlowChartTable({ rows }: { rows: FlowChartRow[] }) {
  const { t } = useTranslation();
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('common.no_data')}</div>;
  return (
    <table className="table" style={{ fontSize: '0.8rem', marginBottom: 8 }}>
      <thead><tr><th>{t('request.flow_line')}</th><th>{t('request.flow_partid')}</th><th>Step</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}><td>{r.location}</td><td>{r.product}</td><td>{r.step}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

const changedRowStyle: React.CSSProperties = {
  outline: '2px solid #dc3545',
  outlineOffset: '-2px',
  background: 'rgba(220,53,69,0.04)',
};

function JayerTable({ rows, changedRowIds = new Set<string>() }: { rows: JayerRow[]; changedRowIds?: Set<string> }) {
  const { t } = useTranslation();
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('common.no_data')}</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table table-compact" style={{ marginBottom: 8 }}>
        <thead><tr><th>Update 날짜</th><th>{t('request.process_id')}</th><th>{t('request.col_sp')}</th><th>{t('request.col_sd')}</th><th>{t('request.col_pp')}</th><th>{t('request.col_st')}</th><th>{t('request.col_new_or_copy')}</th><th>{t('request.col_product_name')}</th><th>{t('request.col_step')}</th><th>{t('request.col_item_id')}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={changedRowIds.has(r.id) ? changedRowStyle : undefined}><td>{r.updated || '-'}</td><td>{r.process_id}</td><td>{r.sp}</td><td>{r.sd}</td><td>{r.pp}</td><td>{r.st}</td><td>{r.new_or_copy}</td><td>{r.product_name}</td><td>{r.step}</td><td>{r.item_id}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OayerTable({ rows, changedRowIds = new Set<string>() }: { rows: OayerRow[]; changedRowIds?: Set<string> }) {
  const { t } = useTranslation();
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('common.no_data')}</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table table-compact" style={{ marginBottom: 8 }}>
        <thead><tr><th>Update 날짜</th><th>{t('request.process_id')}</th><th>{t('request.col_sp')}</th><th>{t('request.col_sd')}</th><th>{t('request.col_pp')}</th><th>{t('request.col_st')}</th><th>{t('request.col_new_or_copy')}</th><th>{t('request.col_product_name')}</th><th>{t('request.col_step')}</th><th>{t('request.col_tt')}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={changedRowIds.has(r.id) ? changedRowStyle : undefined}><td>{r.updated || '-'}</td><td>{r.process_id}</td><td>{r.sp}</td><td>{r.sd}</td><td>{r.pp}</td><td>{r.st}</td><td>{r.new_or_copy}</td><td>{r.product_name}</td><td>{r.step}</td><td>{r.tt}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BbTable({ rows, changedRowIds = new Set<string>() }: { rows: BbTableRow[]; changedRowIds?: Set<string> }) {
  const { t } = useTranslation();
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('common.no_data')}</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table table-compact" style={{ marginBottom: 8 }}>
        <thead><tr><th>{t('request.process_id')}</th><th>{t('request.col_sp')}</th><th>{t('request.col_sd')}</th><th>{t('request.col_bb_process_id')}</th><th>{t('request.col_bb_partid')}</th><th>{t('request.col_bb_layer')}</th><th>{t('request.col_bb_stepseq')}</th><th>{t('request.col_remark')}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={changedRowIds.has(r.id) ? changedRowStyle : undefined}><td>{r.process_id}</td><td>{r.ss}</td><td>{r.sd}</td><td>{r.bb_process_id}</td><td>{r.bb_name}</td><td>{r.bb_step}</td><td>{r.bb_ss}</td><td>{r.remark}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===== Diff Helpers =====

function computeDetailDiff(cur: any, prev: any): Set<string> {
  const changed = new Set<string>();
  const keys = new Set([...Object.keys(cur ?? {}), ...Object.keys(prev ?? {})]);
  for (const k of keys) {
    if (JSON.stringify(cur?.[k]) !== JSON.stringify(prev?.[k])) changed.add(k);
  }
  return changed;
}

function computeTableDiff(cur: Array<{ id: string }>, prev: Array<{ id: string }>): Set<string> {
  const changed = new Set<string>();
  const prevMap = new Map((prev ?? []).map((r) => [r.id, r]));
  for (const row of cur ?? []) {
    const p = prevMap.get(row.id);
    if (!p || JSON.stringify(row) !== JSON.stringify(p)) changed.add(row.id);
  }
  return changed;
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
  let bb: BbTableRow[] = [];
  let history: HistorySnapshot[] = [];

  try {
    const parsed = JSON.parse(doc.additional_notes ?? '{}');
    detail = parsed?.detail ?? {};
    jayer = parsed?.jayerRows ?? [];
    oayer = parsed?.oayerRows ?? [];
    bb = parsed?.bbRows ?? [];
    history = parsed?.history ?? [];
  } catch { /* noop */ }

  const prevSnap = history.length > 0 ? history[history.length - 1] : null;
  const changedFields   = prevSnap ? computeDetailDiff(detail, prevSnap.detail) : new Set<string>();
  const changedJayerIds = prevSnap ? computeTableDiff(jayer, prevSnap.jayerRows ?? []) : new Set<string>();
  const changedOayerIds = prevSnap ? computeTableDiff(oayer, prevSnap.oayerRows ?? []) : new Set<string>();
  const changedBbIds    = prevSnap ? computeTableDiff(bb,    prevSnap.bbRows ?? [])    : new Set<string>();

  const isPL = role === 'PL';
  const isR = role === 'TE_R' || role === 'MASTER' || isPL;
  const isJ = role === 'TE_J' || role === 'MASTER' || isPL;
  const isO = role === 'TE_O' || role === 'MASTER' || isPL;

  const showJayer = isR || isJ || isO;
  const showOayer = isO;
  const showBb = isJ || isO;
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

  // ===== FieldHistoryModal =====
  const FieldHistoryModal = ({
    label, fieldKey, currentValue, onClose,
  }: { label: string; fieldKey: string; currentValue: string; onClose: () => void }) => {
    const rows = [
      ...history.map((snap, i) => ({
        label: `${i + 1}차 제출`,
        timestamp: snap.timestamp,
        value: String((snap.detail as any)?.[fieldKey] ?? '-'),
      })),
      { label: '현재 (최신)', timestamp: null as string | null, value: currentValue },
    ];
    const thStyle: React.CSSProperties = {
      textAlign: 'left', padding: '6px 10px',
      borderBottom: '1px solid var(--border)', fontSize: '0.8rem',
      color: 'var(--text-muted)', fontWeight: 600,
    };
    const tdStyle: React.CSSProperties = { padding: '6px 10px', fontSize: '0.85rem' };
    return (
      <Modal isOpen onClose={onClose} title={`${label} 변경 이력`}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>제출 차수</th>
              <th style={thStyle}>시각</th>
              <th style={thStyle}>값</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isChangedRow = i > 0 && row.value !== rows[i - 1].value;
              const isCurrent = i === rows.length - 1;
              return (
                <tr
                  key={i}
                  style={{
                    background: isCurrent
                      ? 'rgba(37,99,235,0.07)'
                      : isChangedRow ? 'rgba(220,53,69,0.06)' : undefined,
                  }}
                >
                  <td style={tdStyle}>{row.label}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                    {row.timestamp ? new Date(row.timestamp).toLocaleString('ko-KR') : '-'}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: isCurrent ? 700 : 400 }}>{row.value}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Modal>
    );
  };

  // ===== Chip =====
  const Chip = ({
    label, value, style, changed, fieldKey,
  }: {
    label: string;
    value: string | undefined | null;
    style?: React.CSSProperties;
    changed?: boolean;
    fieldKey?: string;
  }) => {
    const [histOpen, setHistOpen] = useState(false);
    if (!value) return null;
    const merged = { ...chipBase, ...style };
    const changedBorder: React.CSSProperties = changed
      ? { border: '2px solid #dc3545', position: 'relative' }
      : {};
    return (
      <div style={{ ...merged, ...changedBorder }}>
        {changed && fieldKey && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setHistOpen(true); }}
              style={{
                position: 'absolute', top: 4, right: 6,
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#dc3545', fontSize: '0.68rem', fontWeight: 700,
                padding: 0, lineHeight: 1,
              }}
            >
              이력 확인
            </button>
            {histOpen && (
              <FieldHistoryModal
                label={label}
                fieldKey={fieldKey}
                currentValue={value}
                onClose={() => setHistOpen(false)}
              />
            )}
          </>
        )}
        <div style={{ ...fieldLabel, textAlign: merged.textAlign as any }}>{label}</div>
        <div style={{ ...fieldValue, textAlign: merged.textAlign as any }}>{value}</div>
      </div>
    );
  };

  const purposeValue = detail.request_purpose
    ? (detail.other_purpose ? `${detail.request_purpose}(${detail.other_purpose})` : detail.request_purpose)
    : '-';
  const basicRow = [
    { label: t('request.request_purpose'), value: purposeValue, fieldKey: 'request_purpose', changed: changedFields.has('request_purpose') || changedFields.has('other_purpose') },
    { label: t('request.line'), value: detail.line || '-', fieldKey: 'line', changed: changedFields.has('line') },
    { label: t('request.process_selection'), value: detail.process_selection || '-', fieldKey: 'process_selection', changed: changedFields.has('process_selection') },
    { label: t('request.partid_selection'), value: detail.partid_selection || '-', fieldKey: 'partid_selection', changed: changedFields.has('partid_selection') },
    { label: t('request.process_id'), value: detail.process_id || '-', fieldKey: 'process_id', changed: changedFields.has('process_id') },
  ];

  const buildProdcInfo = (): string => {
    const lines: string[] = [];
    if (detail.prodc_top_line || detail.prodc_top_process || detail.prodc_top_product) {
      lines.push(`[상판] ${detail.prodc_top_line || '-'} / ${detail.prodc_top_process || '-'} / ${detail.prodc_top_product || '-'}`);
    }
    const middleUse = detail.prodc_middle_use;
    if (middleUse) {
      if (middleUse === '미사용') {
        lines.push('[중판] 미사용');
      } else {
        lines.push(`[중판] ${detail.prodc_middle_line || '-'} / ${detail.prodc_middle_process || '-'} / ${detail.prodc_middle_product || '-'}`);
      }
    }
    if (detail.prodc_bottom_line || detail.prodc_bottom_process || detail.prodc_bottom_product) {
      lines.push(`[하판] ${detail.prodc_bottom_line || '-'} / ${detail.prodc_bottom_process || '-'} / ${detail.prodc_bottom_product || '-'}`);
    }
    return lines.join('\n');
  };

  const isProdc = detail.only_prodc === 'Yes';
  const mshotChange = detail.mshot_change || '없음';
  const mshotHasDetail = mshotChange === '추가' || mshotChange === '수정';
  const mshotIsDelete = mshotChange === '삭제';

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
                <Chip key={item.label} label={item.label} value={item.value} changed={item.changed} fieldKey={item.fieldKey} />
              ))}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={sectionTitle}>{t('approval.section_detail')}</div>

            {(isR || isJ) && (detail.source_line || detail.source_partid) && (
              <div style={rowStyle}>
                <Chip label={t('request.source_line')} value={detail.source_line} changed={changedFields.has('source_line')} fieldKey="source_line" />
                <Chip label={t('request.source_partid_selection')} value={detail.source_partid} changed={changedFields.has('source_partid')} fieldKey="source_partid" />
              </div>
            )}

            {(isJ || isO) && detail.bb_zone && (() => {
              const bbValue = Array.isArray(detail.bb_entries) && detail.bb_entries.length > 0
                ? detail.bb_entries.map((e: { location: string; product: string; process_id: string }, i: number) =>
                    `[${i + 1}] 위치: ${e.location || '-'} / 제품: ${e.product || '-'} / 조리법: ${e.process_id || '-'}`
                  ).join(' / ')
                : '-';
              const bbChanged = changedFields.has('bb_zone') || changedFields.has('bb_entries');
              return (
                <div style={rowStyle}>
                  <Chip label={t('request.bb_status')} value={bbValue} style={chipWide} changed={bbChanged} fieldKey="bb_zone" />
                </div>
              );
            })()}

            {((isO && !isR && !isJ) || role === 'MASTER' || isPL) && detail.change_purpose_note && (
              <div style={rowStyle}>
                <Chip label={t('request.change_purpose_note')} value={detail.change_purpose_note} style={chipFull} changed={changedFields.has('change_purpose_note')} fieldKey="change_purpose_note" />
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

  const showMap = isR || isJ || isO;
  if (showMap) {
    pages.push({
      label: t('request.section_map'),
      content: (
        <div style={cardStyle}>
          <div style={sectionTitle}>🗺️ {t('request.section_map')}</div>

          {(isR || isO || isJ) && (detail.map_change || detail.ea_change) && (
            <div style={rowStyle}>
              {(isR || isO) && detail.map_change && (() => {
                const mapValue = `변경: ${detail.map_change}${detail.map_value_x ? ` / X: ${detail.map_value_x}` : ''}${detail.map_value_y ? ` / Y: ${detail.map_value_y}` : ''}${detail.map_reason ? ` / 사유: ${detail.map_reason}` : ''}`;
                const mapChanged = changedFields.has('map_change') || changedFields.has('map_value_x') || changedFields.has('map_value_y') || changedFields.has('map_reason');
                return (
                  <Chip label={t('request.map')} value={mapValue} style={chipWide} changed={mapChanged} fieldKey="map_change" />
                );
              })()}
              {isR && detail.ea_change && (() => {
                const eaValue = `변경: ${detail.ea_change}${detail.ea_value ? ` / 값: ${detail.ea_value}` : ''}`;
                const eaChanged = changedFields.has('ea_change') || changedFields.has('ea_value');
                return (
                  <Chip label={t('request.ea_change')} value={eaValue} style={chipWide} changed={eaChanged} fieldKey="ea_change" />
                );
              })()}
            </div>
          )}

          {isR && detail.mshot_change && (() => {
            const mshotChanged = changedFields.has('mshot_change') || changedFields.has('mshot_image_copy');
            return (
              <div style={rowStyle}>
                <div style={{ ...chipBase, display: 'flex', gap: 0, textAlign: 'left', flex: '1 1 auto', minWidth: 200, ...(mshotChanged ? { border: '2px solid #dc3545' } : {}) }}>
                  <div style={{ flex: '0 0 auto', paddingRight: 12, borderRight: '1px solid var(--border)', marginRight: 12 }}>
                    <div style={fieldLabel}>{t('request.mshot_change_status')}</div>
                    <div style={fieldValue}>{detail.mshot_change}</div>
                  </div>
                  {mshotIsDelete && (
                    <div style={{ flex: 1 }}>
                      <div style={{ ...fieldLabel, color: '#dc3545' }}>{t('approval.mshot_delete_notice')}</div>
                      <div style={{ ...fieldValue, color: '#dc3545' }}>{t('approval.mshot_delete_desc')}</div>
                    </div>
                  )}
                  {mshotHasDetail && detail.mshot_image_copy && (
                    <div style={{ flex: 1 }}>
                      <div style={fieldLabel}>{t('request.mshot_change_image_attach_area')}</div>
                      <img
                        src={`/media/${detail.mshot_image_copy}`}
                        alt="attached"
                        style={{
                          maxWidth: '300px',
                          maxHeight: '200px',
                          borderRadius: '4px',
                          border: '1px solid #ddd',
                          marginTop: '8px'
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {isR && detail.only_prodc && (() => {
            const prodcChanged = ['only_prodc','prodc_top_line','prodc_top_process','prodc_top_product','prodc_middle_use','prodc_middle_line','prodc_middle_process','prodc_middle_product','prodc_bottom_line','prodc_bottom_process','prodc_bottom_product'].some((k) => changedFields.has(k));
            return (
              <div style={rowStyle}>
                <div style={{ ...chipBase, display: 'flex', gap: 0, textAlign: 'left', flex: '1 1 auto', minWidth: 200, ...(prodcChanged ? { border: '2px solid #dc3545' } : {}) }}>
                  <div style={{ flex: '0 0 auto', paddingRight: 12, borderRight: '1px solid var(--border)', marginRight: 12 }}>
                    <div style={fieldLabel}>{t('request.prodc_status')}</div>
                    <div style={fieldValue}>{detail.only_prodc}</div>
                  </div>
                  {isProdc && buildProdcInfo() && (
                    <div style={{ flex: 1 }}>
                      <div style={fieldLabel}>{t('approval.prodc_detail')}</div>
                      <div style={{ ...fieldValue, whiteSpace: 'pre-line' }}>{buildProdcInfo()}</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {isR && (() => {
            const mapOptions = [
              { label: t('request.backside_adjust'),         fieldKey: 'backside_status', activeValue: 'Yes',       value: detail.backside_status },
              { label: t('request.split_progress_status'),   fieldKey: 'split_progress',  activeValue: '예',         value: detail.split_progress },
              { label: t('request.tmap_application_status'), fieldKey: 'tmap_apply',      activeValue: '적용',       value: detail.tmap_apply },
              { label: t('request.hplhc_status'),            fieldKey: 'hplhc_change',    activeValue: '변경 있음',  value: detail.hplhc_change },
            ];
            const activeOptions = mapOptions.filter(o => o.value === o.activeValue);
            return (
              <div>
                <div style={{ ...fieldLabel, marginBottom: 6 }}>{t('request.map_option_title')}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {activeOptions.map(o => (
                    <div
                      key={o.fieldKey}
                      style={{
                        padding: '4px 14px',
                        borderRadius: 6,
                        background: 'var(--accent)',
                        color: 'white',
                        fontSize: '0.85rem',
                        fontWeight: 500,
                        border: changedFields.has(o.fieldKey) ? '2px solid #dc3545' : 'none',
                      }}
                    >
                      {o.label}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      ),
    });
  }

  if (showJayer) {
    pages.push({
      label: t('request.job_li'),
      content: (
        <div style={cardStyle}>
          <div style={sectionTitle}>{t('request.job_li')}</div>
          <JayerTable rows={jayer} changedRowIds={changedJayerIds} />
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
          <OayerTable rows={oayer} changedRowIds={changedOayerIds} />
        </div>
      ),
    });
  }
  if (showBb) {
    pages.push({
      label: t('request.bb_li'),
      content: (
        <div style={cardStyle}>
          <div style={sectionTitle}>{t('request.bb_li')}</div>
          <BbTable rows={bb} changedRowIds={changedBbIds} />
        </div>
      ),
    });
  }

  // ===== 결재 현황 페이지 =====
  const allSteps = doc.approval_steps ?? [];
  const maxRound = allSteps.reduce((m, s) => Math.max(m, s.round ?? 1), 0) || 1;
  const rounds = Array.from({ length: maxRound }, (_, i) => i + 1);

  const getStep = (agent: string, round: number) =>
    allSteps.find((s) => s.agent === agent && (s.round ?? 1) === round);

  const hasPlel = (() => {
    try {
      const parsed = JSON.parse(doc.additional_notes ?? '{}');
      return (parsed?.jayerRows ?? []).some((r: any) => r.pp?.toLowerCase().includes('plel'));
    } catch { return false; }
  })();

  // 각 회차 상신 날짜: round=1은 doc.submitted_at, 이후 회차는 해당 R 단계의 created_at
  const getRoundSubmittedAt = (round: number): string | null => {
    if (round === 1) return doc.submitted_at ?? null;
    const rStep = allSteps.find((s) => s.agent === 'R' && (s.round ?? 1) === round);
    return rStep?.created_at ?? null;
  };

  // 완료 날짜: 승인된 마지막 단계의 acted_at
  const getApprovedAt = (): string | null => {
    const approved = allSteps.filter((s) => s.action === 'approved' && s.acted_at);
    if (!approved.length) return null;
    return approved.reduce((a, b) =>
      new Date(a.acted_at!) > new Date(b.acted_at!) ? a : b
    ).acted_at;
  };

  const formatDateTime = (d: string | null | undefined): string =>
    d ? new Date(d).toLocaleDateString('ko-KR') : '-';

  const formatDateTimeShort = (d: string | null | undefined): string => {
    if (!d) return '-';
    const dt = new Date(d);
    const date = dt.toLocaleDateString('ko-KR');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    const ss = String(dt.getSeconds()).padStart(2, '0');
    return `${date} ${hh}:${mm}:${ss}`;
  };

  type StepDisplayInfo = {
    status: 'approved' | 'rejected' | 'reviewing' | 'unassigned' | 'waiting' | 'na';
    label: string;
    assignee?: string;
    date?: string;
    comment?: string;
  };

  const getStepDisplay = (agent: string, round: number): StepDisplayInfo => {
    if (agent === 'E' && !hasPlel) {
      return { status: 'na', label: t('approval.step_na') };
    }
    const s = getStep(agent, round);
    if (!s) return { status: 'waiting', label: t('approval.step_pending') };
    if (s.action === 'approved') return {
      status: 'approved', label: t('approval.agree'),
      assignee: s.assignee_name || undefined,
      date: formatDateTime(s.acted_at),
      comment: s.comment || undefined,
    };
    if (s.action === 'rejected') return {
      status: 'rejected', label: t('approval.reject'),
      assignee: s.assignee_name || undefined,
      date: formatDateTime(s.acted_at),
      comment: s.comment || undefined,
    };
    // pending
    if (!s.assignee_name) return { status: 'unassigned', label: t('approval.step_unassigned') };
    return { status: 'reviewing', label: t('common.status_under_review'), assignee: s.assignee_name };
  };

  const statusBadgeStyle = (status: StepDisplayInfo['status']): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
    };
    const colors: Record<StepDisplayInfo['status'], React.CSSProperties> = {
      approved:   { background: '#d4edda', color: '#155724' },
      rejected:   { background: '#f8d7da', color: '#721c24' },
      reviewing:  { background: '#cce5ff', color: '#004085' },
      unassigned: { background: '#e2e3e5', color: '#383d41' },
      waiting:    { background: '#f0f0f0', color: '#adb5bd' },
      na:         { background: '#f0f0f0', color: '#adb5bd' },
    };
    return { ...base, ...colors[status] };
  };

  const teamRowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'flex-start', gap: 12,
    padding: '8px 0', borderBottom: '1px solid var(--border)',
  };

  const teamLabelStyle: React.CSSProperties = {
    minWidth: 64, fontWeight: 700, fontSize: '0.82rem',
    color: 'var(--text-primary)', paddingTop: 2,
  };

  const historyListStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 4, flex: 1,
  };

  const historyItemStyle = (isCurrent: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
    padding: '4px 8px', borderRadius: 6,
    background: isCurrent ? 'rgba(37,99,235,0.05)' : 'transparent',
    fontSize: '0.82rem',
  });

  const AGENTS: Array<{ key: string; label: string }> = [
    { key: 'R', label: t('approval.agent_R') },
    { key: 'J', label: t('approval.agent_J') },
    { key: 'O', label: t('approval.agent_O') },
    { key: 'E', label: t('approval.agent_E') },
  ];

  pages.push({
    label: t('approval.title'),
    content: (
      <div style={cardStyle}>
        <div style={sectionTitle}>{t('approval.title')}</div>

        {/* 상신자 행 */}
        <div style={teamRowStyle}>
          <div style={teamLabelStyle}>{t('approval.label_requester')}</div>
          <div style={historyListStyle}>
            {rounds.map((r) => {
              const isCurrent = r === maxRound;
              const date = formatDateTimeShort(getRoundSubmittedAt(r));
              return (
                <div key={r} style={historyItemStyle(isCurrent)}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', minWidth: 40 }}>{r}회차</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{doc.requester_name}</span>
                  {date && date !== '-' && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{date}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 팀별 행 */}
        {AGENTS.map(({ key, label }) => (
          <div key={key} style={teamRowStyle}>
            <div style={teamLabelStyle}>{label}</div>
            <div style={historyListStyle}>
              {key === 'E' && !hasPlel ? (
                <div style={historyItemStyle(false)}>
                  <span style={{ ...statusBadgeStyle('na') }}>{t('approval.step_na')}</span>
                </div>
              ) : (
                rounds.map((r) => {
                  const isCurrent = r === maxRound;
                  const info = getStepDisplay(key, r);
                  return (
                    <div key={r} style={historyItemStyle(isCurrent)}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', minWidth: 40 }}>{r}회차</span>
                      <span style={statusBadgeStyle(info.status)}>{info.label}</span>
                      {info.assignee && (
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{info.assignee}</span>
                      )}
                      {info.date && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{info.date}</span>
                      )}
                      {info.comment && (
                        <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '0.78rem' }}>
                          "{info.comment}"
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ))}

        {/* 완료 행 */}
        <div style={{ ...teamRowStyle, borderBottom: 'none' }}>
          <div style={teamLabelStyle}>{t('approval.step_done')}</div>
          <div style={historyListStyle}>
            <div style={historyItemStyle(true)}>
              {doc.status === 'approved' ? (
                <>
                  <span style={statusBadgeStyle('approved')}>{t('approval.step_done')}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{formatDateTime(getApprovedAt())}</span>
                </>
              ) : doc.status === 'under_review' ? (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{t('common.status_under_review')}</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    ),
  });

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
