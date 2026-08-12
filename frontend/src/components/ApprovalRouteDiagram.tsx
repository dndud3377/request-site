import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 결재 경로 다이어그램 (전체 가이드 전용)
 * 최종 결재 경로: PL(검토) → R(RFG) →
 *   [경로1: P(PHPSI)] ∥ [경로2: J(JOB)] ∥ [경로3: O(OVL) (+E(EUV))] ∥ [후결자] → 완료
 * (2026-08) J(JOB)는 P 뒤 순차 단계에서 독립 병렬 경로로 분리됐다.
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
        {/* PL 검토 단계는 지정 검토자와 영업/기술지원 합의자가 병렬이다(합의자는 지정했을 때만). */}
        <div className="route-diagram-parallel">
          <div className="route-diagram-path">
            <Box label={agent('PL')} />
          </div>
          <div className="route-diagram-path">
            <Box label={agent('SA')} dim />
          </div>
        </div>
        <Arrow />
        <Box label={t('approval.stage_handler')} />
        <Arrow />
        <Box label={t('approval.stage_reviewer')} dim />
        <Arrow />

        <div className="route-diagram-parallel">
          <div className="route-diagram-path">
            <span className="route-diagram-path-tag">{t('approval.path_label_1')}</span>
            <Box label={agent('P')} />
          </div>
          <div className="route-diagram-path">
            <span className="route-diagram-path-tag">{t('approval.path_label_2')}</span>
            <Box label={agent('J')} />
          </div>
          <div className="route-diagram-path">
            <span className="route-diagram-path-tag">{t('approval.path_label_3')}</span>
            <Box label={agent('O')} />
            <span className="route-diagram-plus" aria-hidden="true">+</span>
            <Box label={agent('E')} dim />
          </div>
          <div className="route-diagram-path">
            <span className="route-diagram-path-tag">{t('approval.stage_post')}</span>
            <Box label={t('approval.stage_post')} />
          </div>
        </div>

        <Arrow />
        <DoneBox label={t('approval.route_diagram.done')} />
      </div>

      <ul className="route-diagram-notes">
        <li>{t('approval.route_diagram.note_sa')}</li>
        <li>{t('approval.route_diagram.note_e')}</li>
        <li>{t('approval.route_diagram.note_onlymap')}</li>
        <li>{t('approval.route_diagram.note_reject')}</li>
      </ul>
    </div>
  );
};

export default ApprovalRouteDiagram;
