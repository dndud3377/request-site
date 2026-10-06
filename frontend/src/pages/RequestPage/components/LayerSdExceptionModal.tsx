import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../components/Modal';
import { LayerSdException, LayerSdExceptionInput, LayerSdMismatch } from '../../../types';

type ExceptionDraft = { process_id: string; sp: string; sd_number: string; layerid: string };

const EMPTY_DRAFT: ExceptionDraft = { process_id: '', sp: '', sd_number: '', layerid: '' };
// 서버 LayerSdExceptionSerializer 의 sd_number 검증과 같은 형식(1000.123 같은 숫자).
const SD_NUMBER_FORMAT = /^\d+(?:\.\d+)*$/;

interface LayerSdExceptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  table: 'J' | 'O';
  exceptions: LayerSdException[];
  loading: boolean;
  loadFailed: boolean;
  /** 현재 작성 중인 문서에서 SD 첫 숫자와 Layer 가 다르고 예외도 아닌 행 — 한 번에 예외로 올릴 수 있다. */
  mismatches: LayerSdMismatch[];
  /** 예외 등록 — 성공 여부를 돌려준다(실패 안내 토스트는 호출부가 띄운다). */
  onAdd: (input: LayerSdExceptionInput) => Promise<boolean>;
  onDelete: (exception: LayerSdException) => Promise<void>;
}

const sectionTitleStyle: React.CSSProperties = {
  fontWeight: 600, fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
};
const cellStyle: React.CSSProperties = { padding: '5px 8px', borderBottom: '1px solid var(--border-light)', textAlign: 'left' };

const LayerSdExceptionModal: React.FC<LayerSdExceptionModalProps> = ({
  isOpen, onClose, table, exceptions, loading, loadFailed, mismatches, onAdd, onDelete,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ExceptionDraft>(EMPTY_DRAFT);
  const [draftInvalid, setDraftInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  // 삭제 버튼을 한 번 눌러 확인 대기 중인 예외 id (DB 삭제 전 확인 — 한 번에 한 건만)
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setDraft(EMPTY_DRAFT);
      setDraftInvalid(false);
      setConfirmingId(null);
    }
  }, [isOpen]);

  const submit = async (input: ExceptionDraft): Promise<boolean> => {
    setBusy(true);
    try {
      return await onAdd({ table, ...input });
    } finally {
      setBusy(false);
    }
  };

  const handleManualAdd = async () => {
    const input: ExceptionDraft = {
      process_id: draft.process_id.trim(), sp: draft.sp.trim(),
      sd_number: draft.sd_number.trim(), layerid: draft.layerid.trim(),
    };
    if (!SD_NUMBER_FORMAT.test(input.sd_number) || !input.layerid) {
      setDraftInvalid(true);
      return;
    }
    setDraftInvalid(false);
    if (await submit(input)) setDraft(EMPTY_DRAFT);
  };

  const handleDelete = async (exception: LayerSdException) => {
    setBusy(true);
    try {
      await onDelete(exception);
    } finally {
      setBusy(false);
      setConfirmingId(null);
    }
  };

  const draftField = (field: keyof ExceptionDraft, label: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 90, fontSize: 12 }}>
      {label}
      <input
        type="text"
        className="form-control"
        data-testid={`sd-exc-draft-${field}`}
        value={draft[field]}
        style={{ fontSize: 13, padding: '5px 8px' }}
        onChange={(e) => setDraft((prev) => ({ ...prev, [field]: e.target.value }))}
      />
    </label>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={table === 'J' ? t('request.sd_layer_exc_title_j') : t('request.sd_layer_exc_title_o')}
      size="lg"
      style={{ width: '640px', maxWidth: '95%' }}
      footer={<button className="btn btn-secondary" onClick={onClose}>{t('common.close')}</button>}
    >
      <div style={{ fontSize: 13 }} data-testid="sd-exc-modal">
        <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>{t('request.sd_layer_exc_desc')}</p>

        <div style={{ marginBottom: 16 }}>
          <div style={sectionTitleStyle}>{t('request.sd_layer_exc_mismatch_title')}</div>
          {mismatches.length === 0 ? (
            <div style={{ color: '#bbb' }}>{t('request.sd_layer_exc_mismatch_empty')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={cellStyle}>{t('request.process_id')}</th>
                  <th style={cellStyle}>{t('request.col_sp')}</th>
                  <th style={cellStyle}>{t('request.col_sd')}</th>
                  <th style={cellStyle}>{t('request.col_layer')}</th>
                  <th style={cellStyle} />
                </tr>
              </thead>
              <tbody>
                {mismatches.map((m) => (
                  <tr key={m.rowId}>
                    <td style={cellStyle}>{m.process_id}</td>
                    <td style={cellStyle}>{m.sp}</td>
                    <td style={cellStyle}>{m.sd}</td>
                    <td style={cellStyle}>{m.layerid}</td>
                    <td style={{ ...cellStyle, textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => submit({ process_id: m.process_id, sp: m.sp, sd_number: m.sdNumber, layerid: m.layerid })}
                      >
                        {t('request.sd_layer_exc_register')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={sectionTitleStyle}>{t('request.sd_layer_exc_manual_title')}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {draftField('process_id', t('request.process_id'))}
            {draftField('sp', t('request.col_sp'))}
            {draftField('sd_number', t('request.sd_layer_exc_col_sd_number'))}
            {draftField('layerid', t('request.col_layer'))}
            <button type="button" className="btn btn-primary" disabled={busy} onClick={handleManualAdd}>
              {t('request.sd_layer_exc_add_btn')}
            </button>
          </div>
          {draftInvalid && (
            <div className="form-error" style={{ marginTop: 6 }}>{t('request.sd_layer_exc_sd_number_invalid')}</div>
          )}
        </div>

        <hr style={{ margin: '14px 0', borderColor: 'var(--border)' }} />

        <div>
          <div style={sectionTitleStyle}>{t('request.sd_layer_exc_saved_title')}</div>
          {loading ? (
            <div style={{ color: '#888' }}>{t('common.loading')}</div>
          ) : loadFailed ? (
            <div className="form-error">{t('request.sd_layer_exc_load_failed')}</div>
          ) : exceptions.length === 0 ? (
            <div style={{ color: '#bbb' }}>{t('request.sd_layer_exc_saved_empty')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="sd-exc-saved-table">
              <thead>
                <tr>
                  <th style={cellStyle}>{t('request.process_id')}</th>
                  <th style={cellStyle}>{t('request.col_sp')}</th>
                  <th style={cellStyle}>{t('request.sd_layer_exc_col_sd_number')}</th>
                  <th style={cellStyle}>{t('request.col_layer')}</th>
                  <th style={cellStyle}>{t('request.sd_layer_exc_col_creator')}</th>
                  <th style={cellStyle} />
                </tr>
              </thead>
              <tbody>
                {exceptions.map((exc) => (
                  <tr key={exc.id}>
                    <td style={cellStyle}>{exc.process_id}</td>
                    <td style={cellStyle}>{exc.sp}</td>
                    <td style={cellStyle}>{exc.sd_number}</td>
                    <td style={cellStyle}>{exc.layerid}</td>
                    <td style={cellStyle}>{exc.created_by_name || exc.created_by}</td>
                    <td style={{ ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {confirmingId === exc.id ? (
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
