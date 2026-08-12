import React from 'react';
import { useTranslation } from 'react-i18next';
import { StageCell, StageCellState } from '../utils/approvalTable';

interface StageGridProps {
  cells: StageCell[];
  /** 열 수. 병렬 합의 단계는 2열(기본), PL 검토 단계는 1열로 두 줄을 세로로 쌓는다. */
  columns?: 1 | 2;
}

// 칸 상태 → 뱃지 문구. '대기중'·'검토중'·'PAUSE' 는 목록 상태뱃지와 같은 문구를 쓴다.
const STATE_I18N_KEY: Record<StageCellState, string> = {
  na: 'approval.step_na',
  wait: 'approval.step_unassigned',
  review: 'common.status_under_review',
  done: 'approval.stage_cell_done',
  pause: 'common.status_pause',
};

// 칸 상태 → 기존 상태뱃지 색 클래스 재사용(해당없음만 신규)
const STATE_BADGE_CLASS: Record<StageCellState, string> = {
  na: 'badge-na',
  wait: 'badge-unassigned',
  review: 'badge-under_review',
  done: 'badge-approved',
  pause: 'badge-pause',
};

/**
 * 병렬 합의 단계의 '현재 단계' 칸 — 3행 2열 고정 그리드(docs/APPROVAL.md §3.3).
 * 6칸이 항상 같은 자리에 있어서 이 문서의 결재 경로에 없는 단계도 '해당없음'으로 드러난다.
 * 뱃지가 단계명 왼쪽에 온다("대기중 PHPSI").
 */
export default function StageGrid({ cells, columns = 2 }: StageGridProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="stage-grid" style={columns === 1 ? { gridTemplateColumns: 'max-content' } : undefined}>
      {cells.map((c) => (
        <span className="stage-cell" key={c.slot}>
          <span className={`badge ${STATE_BADGE_CLASS[c.state]} stage-cell-badge`}>
            {t(STATE_I18N_KEY[c.state] as any)}
          </span>
          <span className={`stage-cell-name${c.state === 'na' || c.state === 'done' ? ' muted' : ''}`}>
            {c.label}{c.name ? `(${c.name})` : ''}
          </span>
          {c.pauseRequested && (
            <span className="pause-req-chip">⏸ {t('approval.pause_requested_chip')}</span>
          )}
        </span>
      ))}
    </div>
  );
}
