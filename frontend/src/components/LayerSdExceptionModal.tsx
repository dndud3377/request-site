import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import { useToast } from './Toast';
import { layerSdExceptionsAPI } from '../api/client';
import { LayerSdException } from '../types';
import { extractSdNumber } from '../pages/RequestPage/helpers';
import { genId } from '../pages/RequestPage/constants';

type SdTable = 'J' | 'O';
// 모달은 역할과 관계없이 늘 두 탭을 보여준다 — 관리 권한이 없는 탭은 조회만 된다.
const SD_TABLES: readonly SdTable[] = ['J', 'O'];
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
  /** 이 사용자가 등록·삭제할 수 있는 표(TE_J: J, TE_O: O, TE_P·MASTER: J·O). 나머지 탭은 조회만 된다. */
  manageableTables: SdTable[];
}

const sectionTitleStyle: React.CSSProperties = {
  fontWeight: 600, fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
};
const cellStyle: React.CSSProperties = { padding: '5px 8px', borderBottom: '1px solid var(--border-light)', textAlign: 'left' };
const inputStyle: React.CSSProperties = {
  width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', fontSize: '0.82rem',
};

/**
 * J/O-layer 'SD 첫 숫자 ↔ Layer 일치' 상신 검사의 예외 관리(홈 화면).
 * J/O 두 탭을 늘 보여주고, 관리 권한이 있는 탭만 등록·삭제할 수 있다(다른 탭은 목록 조회만).
 * 예외 목록 조회·일괄 등록·삭제를 스스로 처리한다. 등록 입력은 여러 행 표이고, 엑셀에서 복사한
 * (Process ID, SP, SD, Layer) 4칸·여러 행을 붙여넣으면 붙여넣은 칸부터 채우고 모자란 행은 자동으로 늘린다.
 */
const LayerSdExceptionModal: React.FC<LayerSdExceptionModalProps> = ({ isOpen, onClose, manageableTables }) => {
  const { t } = useTranslation();
  const addToast = useToast();
  const [table, setTable] = useState<SdTable>(manageableTables[0] ?? 'J');
  const [exceptions, setExceptions] = useState<Record<SdTable, LayerSdException[]>>({ J: [], O: [] });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rows, setRows] = useState<DraftRow[]>([emptyDraftRow()]);
  const [invalidRowIds, setInvalidRowIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // 삭제 버튼을 한 번 눌러 확인 대기 중인 예외 id (DB 삭제 전 확인 — 한 번에 한 건만)
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

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
    setConfirmingId(null);
  };

  const switchTable = (next: SdTable) => {
    setTable(next);
    resetDraft();
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

  const handleAddAll = async () => {
    const filled = rows.map(trimDraftRow).filter((r) => !isDraftRowBlank(r));
    if (filled.length === 0) return;
    const invalid = filled.filter((r) => !isDraftRowValid(r));
    setInvalidRowIds(new Set(invalid.map((r) => r.id)));
    if (invalid.length > 0) return;

    setBusy(true);
    try {
      // 한 행씩 등록한다 — 실패한 행(중복·권한 등)만 입력 표에 남겨 다시 고칠 수 있게 한다.
      const created: LayerSdException[] = [];
      const failedIds = new Set<string>();
      for (const row of filled) {
        try {
          created.push(await layerSdExceptionsAPI.create({
            table, process_id: row.process_id, sp: row.sp, sd: row.sd, layerid: row.layerid,
          }));
        } catch {
          failedIds.add(row.id);
        }
      }
      if (created.length > 0) {
        setExceptions((prev) => ({ ...prev, [table]: [...created.reverse(), ...prev[table]] }));
        addToast(t('request.sd_layer_exc_add_success', { count: created.length }), 'success');
      }
      if (failedIds.size > 0) {
        addToast(t('request.sd_layer_exc_add_failed', { count: failedIds.size }), 'error');
      }
      const remaining = rows.filter((r) => failedIds.has(r.id));
      setRows(remaining.length > 0 ? remaining : [emptyDraftRow()]);
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
  const savedList = exceptions[table];
  const canManage = manageableTables.includes(table);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('request.sd_layer_exc_title')}
      size="lg"
      style={{ width: '720px', maxWidth: '95%' }}
      footer={<button className="btn btn-secondary" onClick={onClose}>{t('common.close')}</button>}
    >
      <div style={{ fontSize: 13 }} data-testid="sd-exc-modal">
        <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>{t('request.sd_layer_exc_desc')}</p>

        <div className="filter-tabs" style={{ marginBottom: 14 }}>
          {SD_TABLES.map((tb) => (
            <button
              key={tb}
              type="button"
              data-testid={`sd-exc-tab-${tb}`}
              className={`filter-tab ${table === tb ? 'active' : ''}`}
              onClick={() => switchTable(tb)}
            >
              {tb === 'J' ? t('request.sd_layer_exc_tab_j') : t('request.sd_layer_exc_tab_o')}
            </button>
          ))}
        </div>

        {canManage ? (
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
                          style={{ fontSize: 11, padding: '2px 7px' }}
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
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setRows((prev) => [...prev, emptyDraftRow()])}>
                + {t('request.sd_layer_exc_row_add')}
              </button>
              <button type="button" className="btn btn-primary btn-sm" data-testid="sd-exc-add-btn" disabled={busy} onClick={handleAddAll}>
                {t('request.sd_layer_exc_add_btn')}
              </button>
            </div>
            {invalidRowIds.size > 0 && (
              <div className="form-error" style={{ marginTop: 6 }}>{t('request.sd_layer_exc_sd_invalid')}</div>
            )}
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 16 }} data-testid="sd-exc-readonly-hint">
            {t('request.sd_layer_exc_readonly_hint')}
          </div>
        )}

        <hr style={{ margin: '14px 0', borderColor: 'var(--border)' }} />

        <div>
          <div style={sectionTitleStyle}>{t('request.sd_layer_exc_saved_title')}</div>
          {loading ? (
            <div style={{ color: '#888' }}>{t('common.loading')}</div>
          ) : loadFailed ? (
            <div className="form-error">{t('request.sd_layer_exc_list_load_failed')}</div>
          ) : savedList.length === 0 ? (
            <div style={{ color: '#bbb' }}>{t('request.sd_layer_exc_saved_empty')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="sd-exc-saved-table">
              <thead>
                <tr>
                  <th style={cellStyle}>{t('request.process_id')}</th>
                  <th style={cellStyle}>{t('request.col_sp')}</th>
                  <th style={cellStyle}>{t('request.col_sd')}</th>
                  <th style={cellStyle}>{t('request.col_layer')}</th>
                  <th style={cellStyle}>{t('request.sd_layer_exc_col_creator')}</th>
                  <th style={cellStyle} />
                </tr>
              </thead>
              <tbody>
                {savedList.map((exc) => (
                  <tr key={exc.id}>
                    <td style={cellStyle}>{exc.process_id}</td>
                    <td style={cellStyle}>{exc.sp}</td>
                    {/* sd 필드 추가 전에 숫자만 등록된 예외는 sd 가 비어 있어 SD 첫 숫자를 대신 보여준다. */}
                    <td style={cellStyle}>{exc.sd || exc.sd_number}</td>
                    <td style={cellStyle}>{exc.layerid}</td>
                    <td style={cellStyle}>{exc.created_by_name || exc.created_by}</td>
                    <td style={{ ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {!canManage ? null : confirmingId === exc.id ? (
                        <>
                          <span style={{ marginRight: 6 }}>{t('request.sd_layer_exc_delete_confirm')}</span>
                          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => handleDelete(exc)}>
                            {t('common.confirm')}
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 4 }} onClick={() => setConfirmingId(null)}>
                            {t('common.cancel')}
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => setConfirmingId(exc.id)}>
                          {t('common.delete')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default LayerSdExceptionModal;
