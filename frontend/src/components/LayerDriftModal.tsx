import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import { LayerDriftGroup, LayerDriftResponse, LayerDriftStepRow } from '../types';
import { formatDate, formatTime } from '../utils/date';

type DriftTabKey = 'jayer' | 'oayer' | 'extra';

const DRIFT_TABS: Array<{
  key: DriftTabKey;
  titleKey: 'approval.layer_drift_jayer_title' | 'approval.layer_drift_oayer_title' | 'approval.layer_drift_extra_title';
}> = [
  { key: 'jayer', titleKey: 'approval.layer_drift_jayer_title' },
  { key: 'oayer', titleKey: 'approval.layer_drift_oayer_title' },
  { key: 'extra', titleKey: 'approval.layer_drift_extra_title' },
];

const isDriftGroupEmpty = (group: LayerDriftGroup | undefined): boolean =>
  !group || (group.removed.length === 0 && group.added.length === 0);

interface LayerDriftModalProps {
  /** 변경 감지 diff. 불러오는 중이면 null. */
  data: LayerDriftResponse | null;
  loading: boolean;
  onClose: () => void;
}

/**
 * '변경 감지' 배지를 눌렀을 때 열리는 diff 모달 — J-layer / O-layer / XXXXXX 별 삭제·추가 행 표.
 * 결재 현황(현재 캐시된 diff)과 이력 조회 반려 탭(반려 시점에 저장된 diff)이 함께 쓴다.
 */
export default function LayerDriftModal({ data, loading, onClose }: LayerDriftModalProps): React.ReactElement {
  const { t } = useTranslation();
  const [driftTab, setDriftTab] = useState<DriftTabKey>('jayer');

  // 실제 변경이 있는 첫 탭을 기본 선택 — 클릭 없이도 변경 내용을 바로 보게 한다.
  useEffect(() => {
    if (!data) return;
    const firstChanged = DRIFT_TABS.find((tab) => !isDriftGroupEmpty(data[tab.key]));
    setDriftTab(firstChanged ? firstChanged.key : 'jayer');
  }, [data]);

  // 변경 현황(ChangeStatusPage) 상세보기와 동일한 구성 — 삭제/추가 각각 배지+표(STEP/내용/Recipe ID/영역/레이어).
  const driftDetailTable = (rows: LayerDriftStepRow[], kind: 'added' | 'removed'): React.ReactElement | null => {
    if (rows.length === 0) return null;
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, marginBottom: 10 }}>
          <span className={`badge ${kind === 'added' ? 'badge-approved' : 'badge-rejected'}`}>
            {t(kind === 'added' ? 'change_status.added_label' : 'change_status.removed_label')}
          </span>
          {t('change_status.count_unit', { count: rows.length })}
        </div>
        <div className="table-wrapper">
          <table className="table table-compact change-status-detail-table">
            <thead>
              <tr>
                <th>{t('change_status.modal_col_step')}</th>
                <th>{t('change_status.modal_col_descript')}</th>
                <th>{t('change_status.modal_col_recipe')}</th>
                <th>{t('change_status.modal_col_area')}</th>
                <th>{t('change_status.modal_col_layer')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  <td><span className="cell-clamp-2">{row.stepseq}</span></td>
                  <td><span className="cell-clamp-2">{row.descript}</span></td>
                  <td><span className="cell-clamp-2">{row.recipeid}</span></td>
                  <td><span className="cell-clamp-2">{row.areaname || '-'}</span></td>
                  <td><span className="cell-clamp-2">{row.layerid || '-'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const driftLayerSection = (group: LayerDriftGroup | undefined): React.ReactElement | null => {
    if (isDriftGroupEmpty(group)) return null;
    return (
      <div style={{ marginBottom: 24 }}>
        {driftDetailTable(group!.removed, 'removed')}
        {driftDetailTable(group!.added, 'added')}
      </div>
    );
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('approval.layer_drift_modal_title')}
      size="md"
      topLevel
      draggable
    >
      {loading || !data ? (
        <p>{t('common.loading')}</p>
      ) : (
        <>
          {data.checked_at && (
            <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              {t('approval.layer_drift_checked_at', {
                date: formatDate(data.checked_at),
                time: formatTime(data.checked_at),
              })}
            </p>
          )}
          <div className="filter-tabs" style={{ marginBottom: 16 }}>
            {DRIFT_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`filter-tab ${driftTab === tab.key ? 'active' : ''}`}
                onClick={() => setDriftTab(tab.key)}
              >
                {t(tab.titleKey)}
              </button>
            ))}
          </div>
          {isDriftGroupEmpty(data[driftTab]) ? (
            <p>{t('change_status.no_data')}</p>
          ) : (
            driftLayerSection(data[driftTab])
          )}
        </>
      )}
    </Modal>
  );
}
