/**
 * claude 수정 (2026-11-16): 결재 경로 탭 — J 표가 전부 '자동 미진행' 키워드 행(또는 0행)이라 J 를 건너뛴 회차의 J(JOB) 행.
 *
 * 백엔드는 그 회차에 J step 을 만들지 않는다(_should_skip_layer_stage). P step 은 있는데 J step 이 없는 회차는
 * '대기'가 아니라 '해당없음'(is_j_skipped 와 같은 판정)이고, 3구역이 열리기 전(R 단계) 회차는 그대로 '대기'다.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PagedDetailView from './PagedDetailView';
import i18n from '../i18n';
import { RequestDocument, ApprovalStepFrontend, AgentType, StepAction } from '../types';

const J_LABEL = i18n.t('approval.agent_J');
const NA = i18n.t('approval.step_na');
const PENDING = i18n.t('approval.step_pending');

const step = (id: number, agent: AgentType, action: StepAction, round: number): ApprovalStepFrontend => ({
  id, agent, action, acted_at: action === 'pending' ? null : '2026-11-01T00:00:00Z',
  assignee_name: action === 'pending' ? '' : `${agent}담당`, round,
});

const makeDoc = (requestPurpose: string, steps: ApprovalStepFrontend[]): RequestDocument => ({
  id: 1,
  title: 'j-skip-doc',
  requester_name: '이의뢰',
  requester_email: 'req@company.com',
  requester_department: 'dept',
  product_name: 'PROD-1',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: { request_purpose: requestPurpose, other_purpose: [] } }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  submitted_at: '2026-11-01T00:00:00Z',
  approval_steps: steps,
});

const Harness: React.FC<{ doc: RequestDocument }> = ({ doc }) => {
  const [pageIdx, setPageIdx] = useState(0);
  return <PagedDetailView doc={doc} role="PL" pageIdx={pageIdx} setPageIdx={setPageIdx} />;
};

/** 결재 경로 탭을 열고 J 행(라벨 + 최신 회차 표시)을 돌려준다. */
const openJRow = (doc: RequestDocument): HTMLElement => {
  render(<Harness doc={doc} />);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('approval.tab_route') }));
  return screen.getByText(J_LABEL).parentElement as HTMLElement;
};

describe('결재 경로 탭 — 표 내용으로 J 를 건너뛴 회차의 J 행', () => {
  it('P step 은 있고 J step 이 없는 회차는 J 가 해당없음이다', () => {
    const row = openJRow(makeDoc('신규', [
      step(1, 'PL', 'approved', 1), step(2, 'R', 'approved', 1),
      step(3, 'P', 'pending', 1), step(4, 'O', 'pending', 1),
    ]));
    expect(within(row).getByText(NA)).toBeTruthy();
    expect(within(row).queryByText(PENDING)).toBeNull();
  });

  it('3구역이 열리기 전(R 단계) 회차의 J 는 그대로 대기다', () => {
    const row = openJRow(makeDoc('신규', [step(1, 'PL', 'approved', 1), step(2, 'R', 'pending', 1)]));
    expect(within(row).getByText(PENDING)).toBeTruthy();
    expect(within(row).queryByText(NA)).toBeNull();
  });
});
