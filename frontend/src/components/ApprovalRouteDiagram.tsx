import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 결재 경로 다이어그램 (전체 가이드 전용)
 * 최종 결재 경로: PL(검토) → R(RFG) → [경로1: P(PHPSI) → J(JOB)] ∥ [경로2: O(OVL) (+E(EUV))] → 완료
 * E(EUV)는 plel 존재 시에만, Only MAP 의뢰는 R까지만 진행한다는 조건을 주석으로 안내한다.
 */
const Box: React.FC<{ label: string; dim?: boolean }> = ({ label, dim }) => (
  <div className={`route-diagram-box${dim ? ' dim' : ''}`}>
    <span className="route-diagram-label">{label}</span>
  </div>
);

// 완료 박스는 현재 표시(약어 ✓ + 라벨) 그대로 유지한다.
const DoneBox: React.FC<{ label: string }> = ({ label }) => (
  <div className="route-diagram-box">
    <span className="route-diagram-code">✓</span>
    <span className="route-diagram-label">{label}</span>
  </div>
);

const Arrow: React.FC = () => <span className="route-diagram-arrow" aria-hidden="true">→</span>;

// embedded/paused는 컴포넌트형 투어 단계 인터페이스 호환용 — 정적 다이어그램이라 사용하지 않는다.
const ApprovalRouteDiagram: React.FC<{ embedded?: boolean; paused?: boolean }> = () => {
  const { t } = useTranslation();
  const agent = (a: string) => t(`approval.agent_${a}` as never) as string;

  return (
    <div className="route-diagram" data-tour="approval-route">
      <div className="route-diagram-title">{t('approval.route_diagram.title')}</div>
      <div className="route-diagram-desc">{t('approval.route_diagram.desc')}</div>

      <div className="route-diagram-flow">
        <Box label={t('approval.route_diagram.product_owner')} />
        <Arrow />
        <Box label={agent('PL')} />
        <Arrow />
        <Box label={agent('R')} />
        <Arrow />

        <div className="route-diagram-parallel">
          <div className="route-diagram-path">
            <span className="route-diagram-path-tag">{t('approval.path_label_phpsi_job')}</span>
            <Box label={agent('P')} />
            <Arrow />
            <Box label={agent('J')} />
          </div>
          <div className="route-diagram-path">
            <span className="route-diagram-path-tag">{t('approval.path_label_ovl_euv')}</span>
            <Box label={agent('O')} />
            <span className="route-diagram-plus" aria-hidden="true">+</span>
            <Box label={agent('E')} dim />
          </div>
        </div>

        <Arrow />
        <DoneBox label={t('approval.route_diagram.done')} />
      </div>

      <ul className="route-diagram-notes">
        <li>{t('approval.route_diagram.note_e')}</li>
        <li>{t('approval.route_diagram.note_onlymap')}</li>
        <li>{t('approval.route_diagram.note_reject')}</li>
      </ul>
    </div>
  );
};

export default ApprovalRouteDiagram;
