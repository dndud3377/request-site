import React from 'react';
import { useTranslation } from 'react-i18next';
import { AdiCdStep } from '../../../types';
import { ADI_CD_STEP_ID_LABEL, ADI_CD_STEP_DESC_LABEL } from '../constants';
import { validateAdiCdRows } from '../helpers';

export type AdiCdSide = 'before' | 'after';
export type AdiCdField = 'step_id' | 'step_desc';

export interface AdiCdPanelProps {
  before: AdiCdStep[];
  after: AdiCdStep[];
  deleteAll: boolean;
  onCellChange: (side: AdiCdSide, id: string, field: AdiCdField, value: string) => void;
  onAddRow: (side: AdiCdSide) => void;
  onRemoveRow: (side: AdiCdSide, id: string) => void;
  /** startRowId: 붙여넣기 시점에 포커스돼 있던 행의 id(어느 셀에서 Ctrl+V 했는지). 못 찾으면 null(표 처음부터). */
  onPasteRaw: (side: AdiCdSide, raw: string, startRowId: string | null) => void;
  onToggleDeleteAll: (next: boolean) => void;
  /** 행 단위 '미등록' 토글 — 켜면 그 행의 STEP_ID/STEP_DESC 를 비우고 잠근다. */
  onToggleUnregistered: (side: AdiCdSide, id: string, next: boolean) => void;
}

/**
 * ADI CD 변경 — 좌 변경전 / 우 변경후 스텝 표.
 * 붙여넣기(파싱·모달 판정)는 부모(index.tsx)가 소유한다 — 이 컴포넌트는 원문 텍스트를 그대로 올려보내기만 한다.
 * 오류 판정(불완전/중복)은 순수 함수 validateAdiCdRows 를 그대로 재사용해, 게이트가 보는 것과 항상 같은 값을 그린다.
 */
const AdiCdPanel: React.FC<AdiCdPanelProps> = ({
  before,
  after,
  deleteAll,
  onCellChange,
  onAddRow,
  onRemoveRow,
  onPasteRaw,
  onToggleDeleteAll,
  onToggleUnregistered,
}) => {
  const { t } = useTranslation();
  const beforeValidation = validateAdiCdRows(before);
  const afterValidation = deleteAll ? null : validateAdiCdRows(after);
  const beforeEmpty = beforeValidation.validCount === 0;

  const handlePaste = (side: AdiCdSide) => (e: React.ClipboardEvent<HTMLTableElement>) => {
    e.preventDefault();
    const raw = e.clipboardData.getData('text/plain');
    if (!raw) return;
    // 붙여넣기 시점에 포커스가 있던 셀이 속한 행을 찾는다 — 그 행부터 값을 채운다.
    const targetEl = e.target as HTMLElement;
    const startRowId = targetEl.closest('tr')?.getAttribute('data-row-id') ?? null;
    onPasteRaw(side, raw, startRowId);
  };

  const cellClass = (validation: ReturnType<typeof validateAdiCdRows> | null, id: string): string => {
    if (!validation) return 'adi-cd-cell';
    if (validation.duplicateIds.includes(id)) return 'adi-cd-cell adi-cd-cell-error';
    if (validation.incompleteIds.includes(id)) return 'adi-cd-cell adi-cd-cell-error';
    return 'adi-cd-cell';
  };

  const renderTable = (side: AdiCdSide, rows: AdiCdStep[], validation: ReturnType<typeof validateAdiCdRows> | null) => (
    <table className="adi-cd-table" onPaste={handlePaste(side)}>
      <thead>
        <tr>
          <th>{ADI_CD_STEP_ID_LABEL}</th>
          <th>{ADI_CD_STEP_DESC_LABEL}</th>
          <th>{t('request.adi_cd_unregistered')}</th>
          <th aria-label={t('common.delete')} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} data-row-id={row.id}>
            {/* 미등록 행은 두 칸을 하나로 합쳐 '미등록'만 보여준다 — 값이 없는 것이 정상 상태라
                빈 입력칸 2개를 남겨두면 "덜 채운 행"으로 오해된다. */}
            {row.unregistered ? (
              <td colSpan={2} className="adi-cd-unreg-cell">{t('request.adi_cd_unregistered')}</td>
            ) : (
              <>
                <td>
                  <input
                    className={cellClass(validation, row.id)}
                    value={row.step_id}
                    onChange={(e) => onCellChange(side, row.id, 'step_id', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className={cellClass(validation, row.id)}
                    value={row.step_desc}
                    onChange={(e) => onCellChange(side, row.id, 'step_desc', e.target.value)}
                  />
                </td>
              </>
            )}
            <td>
              <input
                type="checkbox"
                aria-label={t('request.adi_cd_unregistered')}
                checked={!!row.unregistered}
                onChange={(e) => onToggleUnregistered(side, row.id, e.target.checked)}
              />
            </td>
            <td>
              <button
                type="button"
                className="adi-cd-row-remove"
                title={t('common.delete')}
                onClick={() => onRemoveRow(side, row.id)}
              >
                ✕
              </button>
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={4} className="adi-cd-empty-hint">{t('request.adi_cd_empty_hint')}</td></tr>
        )}
      </tbody>
    </table>
  );

  return (
    <div className="adi-cd-panel">
      <div className="adi-cd-split">
        <div className="adi-cd-pane">
          <div className="adi-cd-pane-title">{t('request.adi_cd_before')}</div>
          <div className="adi-cd-pane-scroll">{renderTable('before', before, beforeValidation)}</div>
          <button type="button" className="btn btn-secondary adi-cd-add-row" onClick={() => onAddRow('before')}>
            + {t('request.adi_cd_add_row')}
          </button>
        </div>
        <div className="adi-cd-pane">
          <div className="adi-cd-pane-title">
            <span>{t('request.adi_cd_after')}</span>
            <label className="adi-cd-delete-all-toggle">
              <input
                type="checkbox"
                checked={deleteAll}
                disabled={!deleteAll && beforeEmpty}
                onChange={(e) => onToggleDeleteAll(e.target.checked)}
              />
              {t('request.adi_cd_delete_all')}
            </label>
          </div>
          {deleteAll ? (
            <div className="adi-cd-delete-all-note">{t('request.adi_cd_delete_all_note')}</div>
          ) : (
            <>
              <div className="adi-cd-pane-scroll">{renderTable('after', after, afterValidation)}</div>
              <button type="button" className="btn btn-secondary adi-cd-add-row" onClick={() => onAddRow('after')}>
                + {t('request.adi_cd_add_row')}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="adi-cd-note">{t('request.adi_cd_paste_hint')}</div>
    </div>
  );
};

export default AdiCdPanel;
