import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import { useToast } from './Toast';
import { layerSdExceptionsAPI } from '../api/client';
import { LayerSdException, LayerSdExceptionSlot, LayerSdExceptionStatus } from '../types';
import { extractSdNumber } from '../pages/RequestPage/helpers';
import { genId, sdExceptionAgreeSlots } from '../pages/RequestPage/constants';
import { formatDateTime } from '../utils/date';

type SdTable = 'J' | 'O';
const SD_TABLES: readonly SdTable[] = ['J', 'O'];
type StatusFilter = LayerSdExceptionStatus | 'ALL';
const STATUS_FILTERS: readonly StatusFilter[] = ['PENDING', 'APPROVED', 'REJECTED', 'ALL'];
const SLOTS: readonly LayerSdExceptionSlot[] = ['team', 'p'];
// 처음 열 때 보여줄 목록 — 합의할 일이 있는지 바로 보이도록 '합의 대기'부터 연다.
const DEFAULT_STATUS_FILTER: StatusFilter = 'PENDING';
// TE_O 는 O 탭부터 연다(나머지는 J 탭).
const O_FIRST_ROLE = 'TE_O';
const STATUS_COLORS: Record<LayerSdExceptionStatus, string> = {
  PENDING: 'var(--warning)',
  APPROVED: 'var(--success)',
  REJECTED: 'var(--danger)',
};
type DraftRow = { id: string; process_id: string; sp: string; sd: string; layerid: string };
type DraftField = Exclude<keyof DraftRow, 'id'>;

// 입력 표의 열 순서 — 엑셀에서 이 순서로 복사한 4칸을 붙여넣으면 그대로 채워진다.
const DRAFT_FIELDS: readonly DraftField[] = ['process_id', 'sp', 'sd', 'layerid'];
const emptyDraftRow = (): DraftRow => ({ id: genId(), process_id: '', sp: '', sd: '', layerid: '' });
const trimDraftRow = (row: DraftRow): DraftRow => ({
  id: row.id, process_id: row.process_id.trim(), sp: row.sp.trim(), sd: row.sd.trim(), layerid: row.layerid.trim(),
});
const isDraftRowBlank = (row: DraftRow): boolean => DRAFT_FIELDS.every((f) => row[f] === '');
// 서버 LayerSdExceptionSerializer 와 같은 기준 — SD 는 숫자로 시작해야 하고 Layer 는 비어 있으면 안 된다.
const isDraftRowValid = (row: DraftRow): boolean => extractSdNumber(row.sd) !== '' && row.layerid !== '';

interface LayerSdExceptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 로그인 사용자 역할 — 합의 칸(team/p) 판정용(`sdExceptionAgreeSlots`). */
  role: string | null | undefined;
  /** 로그인 사용자 ID — 본인 신청 취소 판정용(서버 `created_by` 와 비교). */
  loginid: string;
}

const sectionTitleStyle: React.CSSProperties = {
  fontWeight: 600, fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
};
const cellStyle: React.CSSProperties = { padding: '5px 8px', borderBottom: '1px solid var(--border-light)', textAlign: 'left', verticalAlign: 'top' };
const inputStyle: React.CSSProperties = {
  width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', fontSize: '0.82rem',
};
const mutedStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 11 };
const smallBtnStyle: React.CSSProperties = { fontSize: 11, padding: '2px 7px' };

/**
 * J/O-layer 'SD 첫 숫자 ↔ Layer 일치' 상신 검사의 예외 신청·합의(홈 화면, 로그인한 누구나).
 * 누구나 사유를 적어 신청하고(엑셀 4칸 여러 행 붙여넣기 가능), 합의자가 합의·반려한다 —
 * J 탭은 팀 칸 TE_J + P 칸 TE_P, O 탭은 팀 칸 TE_O + P 칸 TE_P, MASTER 는 두 칸 모두. 두 칸이 다 차면 승인된다.
 * 합의자는 반려·삭제도 할 수 있고, 신청자 본인은 승인 전 신청을 취소할 수 있다.
 */
const LayerSdExceptionModal: React.FC<LayerSdExceptionModalProps> = ({ isOpen, onClose, role, loginid }) => {
  const { t } = useTranslation();
  const addToast = useToast();
  const [table, setTable] = useState<SdTable>(role === O_FIRST_ROLE ? 'O' : 'J');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(DEFAULT_STATUS_FILTER);
  const [exceptions, setExceptions] = useState<Record<SdTable, LayerSdException[]>>({ J: [], O: [] });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rows, setRows] = useState<DraftRow[]>([emptyDraftRow()]);
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const [invalidRowIds, setInvalidRowIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // 삭제·신청 취소 버튼을 한 번 눌러 확인 대기 중인 id (DB 삭제 전 확인 — 한 번에 한 건만)
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  // 반려 사유 입력 중인 id
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    setLoading(true);
    Promise.all(SD_TABLES.map((tb) => layerSdExceptionsAPI.list(tb).then((list) => [tb, list] as const)))
      .then((results) => {
        if (cancelled) return;
        setExceptions((prev) => results.reduce((acc, [tb, list]) => ({ ...acc, [tb]: list }), prev));
        setLoadFailed(false);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen]);

  const resetDraft = () => {
    setRows([emptyDraftRow()]);
    setInvalidRowIds(new Set());
    setReasonMissing(false);
    setConfirmingId(null);
    setRejectingId(null);
  };

  const switchTable = (next: SdTable) => {
    setTable(next);
    resetDraft();
  };

  const replaceException = (updated: LayerSdException) => {
    setExceptions((prev) => ({ ...prev, [updated.table]: prev[updated.table].map((e) => (e.id === updated.id ? updated : e)) }));
  };

  const handleRowChange = (id: string, field: DraftField, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const handleRowDelete = (id: string) => {
    setRows((prev) => (prev.length <= 1 ? [emptyDraftRow()] : prev.filter((r) => r.id !== id)));
  };

  // 엑셀 붙여넣기 — 비고(tbvtlv) 좌표 표와 같은 방식: 붙여넣은 칸부터 오른쪽으로 채우고,
  // 기존 행 수보다 많으면 자동으로 행을 만든다.
  const handleDraftPaste = (e: React.ClipboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) => {
    const text = e.clipboardData.getData('text');
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) return;
    e.preventDefault();
    setRows((prev) => {
      const next = [...prev];
      lines.forEach((line, i) => {
        const targetIdx = rowIdx + i;
        while (next.length <= targetIdx) next.push(emptyDraftRow());
        const updated = { ...next[targetIdx] };
        line.split('\t').forEach((cell, c) => {
          const field = DRAFT_FIELDS[colIdx + c];
          if (field) updated[field] = cell.trim();
        });
        next[targetIdx] = updated;
      });
      return next;
    });
  };

  const handleApplyAll = async () => {
    const filled = rows.map(trimDraftRow).filter((r) => !isDraftRowBlank(r));
    if (filled.length === 0) return;
    const invalid = filled.filter((r) => !isDraftRowValid(r));
    const trimmedReason = reason.trim();
    setInvalidRowIds(new Set(invalid.map((r) => r.id)));
    setReasonMissing(trimmedReason === '');
    if (invalid.length > 0 || trimmedReason === '') return;

    setBusy(true);
    try {
      // 한 행씩 신청한다 — 실패한 행(중복 등)만 입력 표에 남겨 다시 고칠 수 있게 한다.
      const created: LayerSdException[] = [];
      const failedIds = new Set<string>();
      for (const row of filled) {
        try {
          created.push(await layerSdExceptionsAPI.create({
            table, process_id: row.process_id, sp: row.sp, sd: row.sd, layerid: row.layerid, reason: trimmedReason,
          }));
        } catch {
          failedIds.add(row.id);
        }
      }
      if (created.length > 0) {
        setExceptions((prev) => ({ ...prev, [table]: [...created.reverse(), ...prev[table]] }));
        setStatusFilter('PENDING');
        addToast(t('request.sd_layer_exc_add_success', { count: created.length }), 'success');
      }
      if (failedIds.size > 0) {
        addToast(t('request.sd_layer_exc_add_failed', { count: failedIds.size }), 'error');
      } else {
        setReason('');
      }
      const remaining = rows.filter((r) => failedIds.has(r.id));
      setRows(remaining.length > 0 ? remaining : [emptyDraftRow()]);
    } finally {
      setBusy(false);
    }
  };

  const handleAgree = async (exception: LayerSdException, slot: LayerSdExceptionSlot) => {
    setBusy(true);
    try {
      replaceException(await layerSdExceptionsAPI.agree(exception.id, slot));
      addToast(t('request.sd_layer_exc_agree_success'), 'success');
    } catch {
      addToast(t('request.sd_layer_exc_agree_failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (exception: LayerSdException) => {
    const trimmed = rejectReason.trim();
    if (trimmed === '') {
      addToast(t('request.sd_layer_exc_reject_reason_required'), 'error');
      return;
    }
    setBusy(true);
    try {
      replaceException(await layerSdExceptionsAPI.reject(exception.id, trimmed));
      addToast(t('request.sd_layer_exc_reject_success'), 'success');
      setRejectingId(null);
      setRejectReason('');
    } catch {
      addToast(t('request.sd_layer_exc_reject_failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (exception: LayerSdException) => {
    setBusy(true);
    try {
      await layerSdExceptionsAPI.delete(exception.id);
      setExceptions((prev) => ({ ...prev, [exception.table]: prev[exception.table].filter((e) => e.id !== exception.id) }));
      addToast(t('request.sd_layer_exc_delete_success'), 'success');
    } catch {
      addToast(t('request.sd_layer_exc_delete_failed'), 'error');
    } finally {
      setBusy(false);
      setConfirmingId(null);
    }
  };

  const draftHeaders: Record<DraftField, string> = {
    process_id: t('request.process_id'),
    sp: t('request.col_sp'),
    sd: t('request.col_sd'),
    layerid: t('request.col_layer'),
  };
  const tableList = exceptions[table];
  const visibleList = statusFilter === 'ALL' ? tableList : tableList.filter((e) => e.status === statusFilter);
  const countOf = (filter: StatusFilter) =>
    filter === 'ALL' ? tableList.length : tableList.filter((e) => e.status === filter).length;
  const pendingOf = (tb: SdTable) => exceptions[tb].filter((e) => e.status === 'PENDING').length;
  const agreeSlots = sdExceptionAgreeSlots(role, table);
  const canDecide = agreeSlots.length > 0;
  const slotHeaders: Record<LayerSdExceptionSlot, string> = {
    team: table === 'J' ? t('request.sd_layer_exc_col_team_j') : t('request.sd_layer_exc_col_team_o'),
    p: t('request.sd_layer_exc_col_p'),
  };

  const renderAgreeCell = (exc: LayerSdException, slot: LayerSdExceptionSlot) => {
    const by = slot === 'team' ? exc.team_agreed_by_name || exc.team_agreed_by : exc.p_agreed_by_name || exc.p_agreed_by;
    const at = slot === 'team' ? exc.team_agreed_at : exc.p_agreed_at;
    if (by) {
      return (
        <>
          <div>✓ {by}</div>
          <div style={mutedStyle}>{formatDateTime(at)}</div>
        </>
      );
    }
    if (exc.status !== 'PENDING') return <span style={mutedStyle}>-</span>;
    if (agreeSlots.includes(slot)) {
      return (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={smallBtnStyle}
          data-testid={`sd-exc-agree-${slot}-${exc.id}`}
          disabled={busy}
          onClick={() => handleAgree(exc, slot)}
        >
          {t('request.sd_layer_exc_agree_btn')}
        </button>
      );
    }
    return <span style={mutedStyle}>{t('request.sd_layer_exc_waiting')}</span>;
  };

  const renderActions = (exc: LayerSdException) => {
    const isOwnUnapproved = exc.created_by === loginid && exc.status !== 'APPROVED';
    const canDelete = canDecide || isOwnUnapproved;
    const isCancel = !canDecide && isOwnUnapproved;
    if (rejectingId === exc.id) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140 }}>
          <input
            type="text"
            data-testid={`sd-exc-reject-reason-${exc.id}`}
            style={inputStyle}
            value={rejectReason}
            placeholder={t('request.sd_layer_exc_reject_reason_placeholder')}
            disabled={busy}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-danger btn-sm" style={smallBtnStyle} data-testid={`sd-exc-reject-confirm-${exc.id}`} disabled={busy} onClick={() => handleReject(exc)}>
              {t('common.confirm')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" style={smallBtnStyle} disabled={busy} onClick={() => setRejectingId(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      );
    }
    if (confirmingId === exc.id) {
      return (
        <>
          <span style={{ marginRight: 6 }}>
            {isCancel ? t('request.sd_layer_exc_cancel_confirm') : t('request.sd_layer_exc_delete_confirm')}
          </span>
          <button type="button" className="btn btn-danger btn-sm" style={smallBtnStyle} data-testid={`sd-exc-delete-confirm-${exc.id}`} disabled={busy} onClick={() => handleDelete(exc)}>
            {t('common.confirm')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" style={{ ...smallBtnStyle, marginLeft: 4 }} onClick={() => setConfirmingId(null)}>
            {t('common.cancel')}
          </button>
        </>
      );
    }
    return (
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        {canDecide && exc.status === 'PENDING' && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={smallBtnStyle}
            data-testid={`sd-exc-reject-${exc.id}`}
            disabled={busy}
            onClick={() => { setRejectingId(exc.id); setRejectReason(''); setConfirmingId(null); }}
          >
            {t('request.sd_layer_exc_reject_btn')}
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            style={smallBtnStyle}
            data-testid={`sd-exc-delete-${exc.id}`}
            disabled={busy}
            onClick={() => { setConfirmingId(exc.id); setRejectingId(null); }}
          >
            {isCancel ? t('request.sd_layer_exc_cancel_btn') : t('common.delete')}
          </button>
        )}
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('request.sd_layer_exc_title')}
      size="lg"
      style={{ width: '1100px', maxWidth: '95%' }}
      footer={<button className="btn btn-secondary" onClick={onClose}>{t('common.close')}</button>}
    >
      <div style={{ fontSize: 13 }} data-testid="sd-exc-modal">
        <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>{t('request.sd_layer_exc_desc')}</p>

        <div className="filter-tabs" style={{ marginBottom: 14 }}>
          {SD_TABLES.map((tb) => {
            const label = tb === 'J' ? t('request.sd_layer_exc_tab_j') : t('request.sd_layer_exc_tab_o');
            const pending = pendingOf(tb);
            return (
              <button
                key={tb}
                type="button"
                data-testid={`sd-exc-tab-${tb}`}
                className={`filter-tab ${table === tb ? 'active' : ''}`}
                onClick={() => switchTable(tb)}
              >
                {pending > 0 ? t('request.sd_layer_exc_tab_count', { tab: label, count: pending }) : label}
              </button>
            );
          })}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={sectionTitleStyle}>
            {table === 'J' ? t('request.sd_layer_exc_manual_title_j') : t('request.sd_layer_exc_manual_title_o')}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 6 }}>{t('request.sd_layer_exc_paste_hint')}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="sd-exc-draft-table">
            <thead>
              <tr>
                {DRAFT_FIELDS.map((f) => <th key={f} style={cellStyle}>{draftHeaders[f]}</th>)}
                <th style={{ ...cellStyle, width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => {
                const invalid = invalidRowIds.has(row.id);
                return (
                  <tr key={row.id} data-testid="sd-exc-draft-row">
                    {DRAFT_FIELDS.map((field, colIdx) => (
                      <td key={field} style={cellStyle}>
                        <input
                          type="text"
                          data-testid={`sd-exc-draft-${field}-${rowIdx}`}
                          value={row[field]}
                          disabled={busy}
                          style={invalid ? { ...inputStyle, borderColor: 'var(--danger)' } : inputStyle}
                          onChange={(e) => handleRowChange(row.id, field, e.target.value)}
                          onPaste={(e) => handleDraftPaste(e, rowIdx, colIdx)}
                        />
                      </td>
                    ))}
                    <td style={{ ...cellStyle, textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={smallBtnStyle}
                        title={t('common.delete')}
                        disabled={busy}
                        onClick={() => handleRowDelete(row.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <label style={{ display: 'block', marginTop: 8, fontWeight: 600, fontSize: 12 }} htmlFor="sd-exc-reason">
            {t('request.sd_layer_exc_reason_label')}
          </label>
          <textarea
            id="sd-exc-reason"
            data-testid="sd-exc-reason"
            rows={2}
            value={reason}
            disabled={busy}
            placeholder={t('request.sd_layer_exc_reason_placeholder')}
            style={reasonMissing ? { ...inputStyle, borderColor: 'var(--danger)', resize: 'vertical' } : { ...inputStyle, resize: 'vertical' }}
            onChange={(e) => { setReason(e.target.value); if (e.target.value.trim()) setReasonMissing(false); }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setRows((prev) => [...prev, emptyDraftRow()])}>
              + {t('request.sd_layer_exc_row_add')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" data-testid="sd-exc-add-btn" disabled={busy} onClick={handleApplyAll}>
              {t('request.sd_layer_exc_add_btn')}
            </button>
          </div>
          {invalidRowIds.size > 0 && (
            <div className="form-error" style={{ marginTop: 6 }}>{t('request.sd_layer_exc_sd_invalid')}</div>
          )}
          {reasonMissing && (
            <div className="form-error" style={{ marginTop: 6 }} data-testid="sd-exc-reason-error">{t('request.sd_layer_exc_reason_required')}</div>
          )}
        </div>

        <hr style={{ margin: '14px 0', borderColor: 'var(--border)' }} />

        <div>
          <div style={sectionTitleStyle}>{t('request.sd_layer_exc_saved_title')}</div>
          <div className="filter-tabs" style={{ marginBottom: 10 }}>
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                data-testid={`sd-exc-filter-${filter}`}
                className={`filter-tab ${statusFilter === filter ? 'active' : ''}`}
                onClick={() => { setStatusFilter(filter); setConfirmingId(null); setRejectingId(null); }}
              >
                {t('request.sd_layer_exc_tab_count', {
                  tab: filter === 'ALL' ? t('request.sd_layer_exc_filter_all') : t(`request.sd_layer_exc_status_${filter}`),
                  count: countOf(filter),
                })}
              </button>
            ))}
          </div>
          {loading ? (
            <div style={{ color: '#888' }}>{t('common.loading')}</div>
          ) : loadFailed ? (
            <div className="form-error">{t('request.sd_layer_exc_list_load_failed')}</div>
          ) : visibleList.length === 0 ? (
            <div style={{ color: '#bbb' }} data-testid="sd-exc-saved-empty">{t('request.sd_layer_exc_saved_empty')}</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="sd-exc-saved-table">
                <thead>
                  <tr>
                    <th style={cellStyle}>{t('request.sd_layer_exc_col_status')}</th>
                    <th style={cellStyle}>{t('request.process_id')}</th>
                    <th style={cellStyle}>{t('request.col_sp')}</th>
                    <th style={cellStyle}>{t('request.col_sd')}</th>
                    <th style={cellStyle}>{t('request.col_layer')}</th>
                    <th style={cellStyle}>{t('request.sd_layer_exc_col_reason')}</th>
                    <th style={cellStyle}>{t('request.sd_layer_exc_col_creator')}</th>
                    {SLOTS.map((slot) => <th key={slot} style={cellStyle}>{slotHeaders[slot]}</th>)}
                    <th style={cellStyle} />
                  </tr>
                </thead>
                <tbody>
                  {visibleList.map((exc) => (
                    <tr key={exc.id} data-testid={`sd-exc-row-${exc.id}`}>
                      <td style={cellStyle}>
                        <span style={{ color: STATUS_COLORS[exc.status], fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {t(`request.sd_layer_exc_status_${exc.status}`)}
                        </span>
                        {exc.status === 'REJECTED' && (
                          <div style={mutedStyle}>
                            {t('request.sd_layer_exc_rejected_by', { name: exc.rejected_by_name || exc.rejected_by, reason: exc.reject_reason })}
                          </div>
                        )}
                      </td>
                      <td style={cellStyle}>{exc.process_id}</td>
                      <td style={cellStyle}>{exc.sp}</td>
                      {/* sd 필드 추가 전에 숫자만 등록된 예외는 sd 가 비어 있어 SD 첫 숫자를 대신 보여준다. */}
                      <td style={cellStyle}>{exc.sd || exc.sd_number}</td>
                      <td style={cellStyle}>{exc.layerid}</td>
                      <td style={{ ...cellStyle, whiteSpace: 'pre-wrap', maxWidth: 220 }}>{exc.reason || '-'}</td>
                      <td style={cellStyle}>
                        <div>{exc.created_by_name || exc.created_by}</div>
                        <div style={mutedStyle}>{formatDateTime(exc.created_at)}</div>
                      </td>
                      {SLOTS.map((slot) => <td key={slot} style={cellStyle}>{renderAgreeCell(exc, slot)}</td>)}
                      <td style={{ ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>{renderActions(exc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default LayerSdExceptionModal;
