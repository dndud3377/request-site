import React from 'react';
import { useTranslation } from 'react-i18next';
import { DocSubStage } from '../utils/approvalTable';

interface StageDotsProps {
  subStages: DocSubStage[];
}

const STATE_I18N_KEY: Record<DocSubStage['state'], string> = {
  wait: 'approval.step_unassigned',
  review: 'common.status_under_review',
  done: 'common.status_approved',
};

// 경로2(O+E)가 진행 중일 때 O/E 각각의 상태를 점으로 보여준다 — 대표 뱃지 하나로는
// "한쪽만 검토중" 같은 중간 상태가 안 드러나기 때문(docs/APPROVAL.md §3.3).
export default function StageDots({ subStages }: StageDotsProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      {subStages.map((s) => (
        <span className="dot-ind" key={s.label} title={t(STATE_I18N_KEY[s.state] as any)}>
          <span className={`dot dot-${s.state}`} />
          {s.label}
          {s.name ? `(${s.name})` : ''}
        </span>
      ))}
    </>
  );
}
