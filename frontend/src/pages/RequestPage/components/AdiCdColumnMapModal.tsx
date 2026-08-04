import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../components/Modal';
import { ADI_CD_STEP_ID_LABEL, ADI_CD_STEP_DESC_LABEL } from '../constants';

type ColRole = 'STEP_ID' | 'STEP_DESC' | 'NONE';

const PREVIEW_ROWS = 3;

export interface AdiCdColumnMapModalProps {
  isOpen: boolean;
  /** 붙여넣은 표 전체(파싱된 원본) */
  grid: string[][];
  /** 헤더 자동 인식 결과 — 있으면 미리 선택한다 */
  initialStepIdCol: number | null;
  initialStepDescCol: number | null;
  onCancel: () => void;
  onConfirm: (mapping: { stepIdCol: number; stepDescCol: number; skipFirstRow: boolean }) => void;
}

/**
 * ADI CD 변경 붙여넣기 컬럼 매핑 모달.
 * 상위 3행 미리보기 + 열마다 역할 드롭다운(STEP_ID/STEP_DESC/사용 안 함).
 * 같은 역할을 다른 열에 다시 고르면 이전 지정은 자동으로 해제한다(열-역할은 1:1).
 * "첫 행을 헤더로 제외"는 헤더 자동 인식 성공 시 켜짐, 실패 시 꺼짐으로 시작 — 판단을 사람에게 맡긴다.
 */
const AdiCdColumnMapModal: React.FC<AdiCdColumnMapModalProps> = ({
  isOpen,
  grid,
  initialStepIdCol,
  initialStepDescCol,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const columnCount = Math.max(1, ...grid.map((row) => row.length));
  const [colRoles, setColRoles] = useState<ColRole[]>([]);
  const [skipFirstRow, setSkipFirstRow] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const roles: ColRole[] = Array.from({ length: columnCount }, () => 'NONE');
    if (initialStepIdCol !== null) roles[initialStepIdCol] = 'STEP_ID';
    if (initialStepDescCol !== null) roles[initialStepDescCol] = 'STEP_DESC';
    setColRoles(roles);
    setSkipFirstRow(initialStepIdCol !== null && initialStepDescCol !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, grid, initialStepIdCol, initialStepDescCol]);

  if (!isOpen) return null;

  const handleRoleChange = (colIdx: number, role: ColRole) => {
    setColRoles((prev) => prev.map((r, i) => {
      if (i === colIdx) return role;
      if (role !== 'NONE' && r === role) return 'NONE';
      return r;
    }));
  };

  const stepIdCol = colRoles.indexOf('STEP_ID');
  const stepDescCol = colRoles.indexOf('STEP_DESC');
  const canConfirm = stepIdCol !== -1 && stepDescCol !== -1;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={t('request.adi_cd_column_map_title')}
      size="lg"
      hideFullscreen
      footer={
        <>
          <button className="btn btn-secondary" onClick={onCancel}>{t('common.cancel')}</button>
          <button
            className="btn btn-primary"
            disabled={!canConfirm}
            onClick={() => onConfirm({ stepIdCol, stepDescCol, skipFirstRow })}
          >
            {t('common.confirm')}
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 10 }}>
        {t('request.adi_cd_column_map_desc')}
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="adi-cd-map-table">
          <thead>
            <tr>
              {Array.from({ length: columnCount }, (_, colIdx) => (
                <th key={colIdx}>
                  <select
                    value={colRoles[colIdx] ?? 'NONE'}
                    onChange={(e) => handleRoleChange(colIdx, e.target.value as ColRole)}
                  >
                    <option value="NONE">{t('request.adi_cd_column_role_none')}</option>
                    <option value="STEP_ID">{ADI_CD_STEP_ID_LABEL}</option>
                    <option value="STEP_DESC">{ADI_CD_STEP_DESC_LABEL}</option>
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.slice(0, PREVIEW_ROWS).map((row, rowIdx) => (
              <tr key={rowIdx}>
                {Array.from({ length: columnCount }, (_, colIdx) => (
                  <td key={colIdx}>{row[colIdx] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="adi-cd-skip-header-label">
        <input
          type="checkbox"
          checked={skipFirstRow}
          onChange={(e) => setSkipFirstRow(e.target.checked)}
        />
        {t('request.adi_cd_skip_first_row')}
      </label>
    </Modal>
  );
};

export default AdiCdColumnMapModal;
