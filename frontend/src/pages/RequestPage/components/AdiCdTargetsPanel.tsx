import React from 'react';
import { useTranslation } from 'react-i18next';
import AutocompleteInput from '../../../components/AutocompleteInput';
import { AdiCdTarget } from '../../../types';

export interface AdiCdTargetsPanelProps {
  /** 1행 — 위쪽 라인/조합법/제품 이름/조리법 필드에서 이미 고른 값을 그대로 읽기 전용으로 보여준다. */
  firstPartidSelection: string;
  firstProcessId: string;
  /** 2행부터의 값만 담는다. */
  targets: AdiCdTarget[];
  /** 제품 이름 옵션 — 이미 선택한 라인+조합법 기준(위쪽 필드와 동일한 목록을 재사용). */
  productOptions: string[];
  /** 조리법 옵션 — 행마다 자신의 제품 이름 기준으로 독립적으로 fetch된 값(행 id로 키). */
  processIdOptions: Record<string, string[]>;
  onAdd: () => void;
  onChange: (id: string, field: 'partid_selection' | 'process_id', value: string) => void;
  onDelete: (id: string) => void;
  error?: string;
}

/**
 * ADI CD 변경 — '동일 변경 적용 대상' 표. 라인/조합법은 고정하고 제품 이름·조리법 조합만 여러 개
 * 등록할 수 있게 한다. 1행은 Step1 상단 필드(partid_selection/process_id)를 그대로 보여주는
 * 읽기 전용 행이라 별도로 저장하지 않고, 2행부터(targets)만 detail.adi_cd_extra_targets 에 저장된다.
 */
const AdiCdTargetsPanel: React.FC<AdiCdTargetsPanelProps> = ({
  firstPartidSelection,
  firstProcessId,
  targets,
  productOptions,
  processIdOptions,
  onAdd,
  onChange,
  onDelete,
  error,
}) => {
  const { t } = useTranslation();

  return (
    <div className="adi-cd-targets-panel">
      <div className="form-label" style={{ marginBottom: 6 }}>{t('request.adi_cd_targets_title')}</div>
      <table className="adi-cd-targets-table">
        <thead>
          <tr>
            <th>{t('request.partid_selection')}</th>
            <th>{t('request.process_id')}</th>
            <th aria-label={t('common.delete')} />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="adi-cd-targets-fixed">{firstPartidSelection}</td>
            <td className="adi-cd-targets-fixed">{firstProcessId}</td>
            <td />
          </tr>
          {targets.map((row) => (
            <tr key={row.id}>
              <td>
                <AutocompleteInput
                  value={row.partid_selection}
                  onChange={(v) => onChange(row.id, 'partid_selection', v)}
                  options={productOptions}
                  placeholder={t('request.select_placeholder')}
                  style={{ width: '100%' }}
                />
              </td>
              <td>
                <AutocompleteInput
                  value={row.process_id}
                  onChange={(v) => onChange(row.id, 'process_id', v)}
                  options={processIdOptions[row.id] || []}
                  placeholder={t('request.select_placeholder')}
                  style={{ width: '100%' }}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="adi-cd-targets-remove"
                  title={t('common.delete')}
                  onClick={() => onDelete(row.id)}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn btn-secondary adi-cd-targets-add" onClick={onAdd}>
        + {t('request.adi_cd_targets_add')}
      </button>
      {error && <span className="form-error">{error}</span>}
    </div>
  );
};

export default AdiCdTargetsPanel;
