import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 결재 경로 다이어그램 (전체 가이드 전용)
 * 최종 결재 경로: PL(검토) → R(RFG) → [경로1: P(PHPSI) → J(JOB)] ∥ [경로2: O(OVL) (+E(EUV))] → 완료
 * E(EUV)는 plel 존재 시에만, Only MAP 의뢰는 R까지만 진행한다는 조건을 주석으로 안내한다.
 */
const Box: React.FC<{ code: string; label: string; dim?: boolean }> = ({ code, label, dim }) => (
  <div className={`route-diagram-box${dim ? ' dim' : ''}`}>
    <span className="route-diagram-code">{code}</span>
    <span className="route-diagram-label">{label}</span>
  </div>
);

const Arrow: React.FC = () => <span className="route-diagram-arrow" aria-hidden="true">→</span>;

const ApprovalRouteDiagram: React.FC = () => {
  const { t } = useTranslation();
  const agent = (a: string) => t(`approval.agent_${a}` as never) as string;

  return (
    <div className="route-diagram" data-tour="approval-route">
      <div className="route-diagram-title">{t('approval.route_diagram.title')}</div>
      <div className="route-diagram-desc">{t('approval.route_diagram.desc')}</div>

      <div className="route-diagram-flow">
        <Box code="PL" label={agent('PL')} />
        <Arrow />
        <Box code="R" label={agent('R')} />
        <Arrow />

        <div className="route-diagram-parallel">
          <div className="route-diagram-path">
            <span className="route-diagram-path-tag">{t('approval.path_label_phpsi_job')}</span>
            <Box code="P" label={agent('P')} />
            <Arrow />
            <Box code="J" label={agent('J')} />
          </div>
          <div className="route-diagram-path">
            <span className="route-diagram-path-tag">{t('approval.path_label_ovl_euv')}</span>
            <Box code="O" label={agent('O')} />
            <span className="route-diagram-plus" aria-hidden="true">+</span>
            <Box code="E" label={agent('E')} dim />
          </div>
        </div>

        <Arrow />
        <Box code="✓" label={t('approval.route_diagram.done')} />
      </div>

      <ul className="route-diagram-notes">
        <li>{t('approval.route_diagram.note_e')}</li>
        <li>{t('approval.route_diagram.note_onlymap')}</li>
      </ul>
    </div>
  );
};

export default ApprovalRouteDiagram;
