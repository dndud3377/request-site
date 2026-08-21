import React from 'react';
import { useTranslation } from 'react-i18next';
import AutocompleteInput from '../../../components/AutocompleteInput';
import { AdiCdTarget } from '../../../types';

export interface AdiCdTargetsPanelProps {
  /** 1행 — 위쪽 라인/조합법/제품 이름/조리법 필드에서 이미 고른 값을 그대로 읽기 전용으로 보여준다. */
  firstPartidSelection: string;
  firstProcessId: string;
  /** 2행부터의 값만 담는다(모두 확정돼 저장된 값 — 표 안에서는 더 이상 편집하지 않는다). */
  targets: AdiCdTarget[];
  /** 아직 표에 반영하지 않은, 지금 입력 중인 값(상시 노출 입력칸). */
  draftPartidSelection: string;
  draftProcessId: string;
  /** 제품 이름 옵션 — 이미 선택한 라인+조합법 기준(위쪽 필드와 동일한 목록을 재사용). */
  productOptions: string[];
  /** 조리법 옵션 — 지금 입력 중인 제품 이름 기준으로 독립 fetch된 값(입력칸 1개분). */
  draftProcessIdOptions: string[];
  onDraftChange: (field: 'partid_selection' | 'process_id', value: string) => void;
  /** 입력칸 값을 검증(완전성·중복)해 통과하면 표에 반영하고 입력칸을 비운다. 실패 시 토스트로 막는다. */
  onAdd: () => void;
  onDelete: (id: string) => void;
}

/**
 * ADI CD 변경 — '동일 변경 적용 대상' 표. 라인/조합법은 고정하고 제품 이름·조리법 조합만 여러 개
 * 등록할 수 있게 한다. 1행은 Step1 상단 필드(partid_selection/process_id)를 그대로 보여주는
 * 읽기 전용 행이라 별도로 저장하지 않고, 2행부터(targets)만 detail.adi_cd_extra_targets 에 저장된다.
 * 표 안 행은 읽기 전용이다 — 값은 표 아래 상시 입력칸에서 채운 뒤 "추가" 버튼으로만 반영된다
 * (완전성·중복 검사는 그 버튼 클릭 시점에 index.tsx 가 수행한다).
 */
const AdiCdTargetsPanel: React.FC<AdiCdTargetsPanelProps> = ({
  firstPartidSelection,
  firstProcessId,
  targets,
  draftPartidSelection,
  draftProcessId,
  productOptions,
  draftProcessIdOptions,
  onDraftChange,
  onAdd,
  onDelete,
}) => {
  const { t } = useTranslation();
  const canAdd = !!draftPartidSelection.trim() && !!draftProcessId.trim();

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
              <td>{row.partid_selection}</td>
              <td>{row.process_id}</td>
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
      <div className="adi-cd-targets-draft">
        <AutocompleteInput
          value={draftPartidSelection}
          onChange={(v) => onDraftChange('partid_selection', v)}
          options={productOptions}
          placeholder={t('request.partid_selection')}
          style={{ flex: 1 }}
        />
        <AutocompleteInput
          value={draftProcessId}
          onChange={(v) => onDraftChange('process_id', v)}
          options={draftProcessIdOptions}
          placeholder={t('request.process_id')}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn btn-secondary adi-cd-targets-add" onClick={onAdd} disabled={!canAdd}>
          + {t('request.adi_cd_targets_add')}
        </button>
      </div>
    </div>
  );
};

export default AdiCdTargetsPanel;
