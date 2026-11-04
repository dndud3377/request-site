/**
 * claude 수정 (2026-11-04): 결재 경로 탭 — O 재합의 생략(Case U) 회차의 O(OVL) 행.
 *
 * 백엔드는 이전 회차에 O 가 합의했고 Jayer·Oayer·MAP 정보가 그대로면 새 회차에 O step 을 만들지
 * 않는다(_should_skip_o_stage). P step 은 있는데 O step 이 없는 회차는 '대기'가 아니라
 * '해당없음'이어야 하고, 아직 3구역이 열리기 전(PL 단계) 회차는 그대로 '대기'다.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PagedDetailView from './PagedDetailView';
import i18n from '../i18n';
import { RequestDocument, ApprovalStepFrontend } from '../types';

const O_LABEL = i18n.t('approval.agent_O');
const NA = i18n.t('approval.step_na');
const PENDING = i18n.t('approval.step_pending');

const step = (id: number, agent: string, action: string, round: number): ApprovalStepFrontend => ({
  id, agent, action, acted_at: action === 'pending' ? null : '2026-11-01T00:00:00Z',
  assignee_name: action === 'pending' ? '' : `${agent}담당`, round,
});

const makeDoc = (requestPurpose: string, steps: ApprovalStepFrontend[]): RequestDocument => ({
  id: 1,
  title: 'o-skip-doc',
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

/** 결재 경로 탭을 열고 O 행(라벨 + 최신 회차 표시)을 돌려준다. */
const openORow = (doc: RequestDocument): HTMLElement => {
  render(<Harness doc={doc} />);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('approval.tab_route') }));
  return screen.getByText(O_LABEL).parentElement as HTMLElement;
};

const round1 = [
  step(1, 'PL', 'approved', 1), step(2, 'R', 'approved', 1),
  step(3, 'P', 'rejected', 1), step(4, 'J', 'approved', 1), step(5, 'O', 'approved', 1),
];

describe('결재 경로 탭 — O 재합의 생략 회차의 O 행', () => {
  it('P step 은 있고 O step 이 없는 회차는 O 가 해당없음이다', () => {
    const row = openORow(makeDoc('신규', [
      ...round1, step(6, 'PL', 'approved', 2), step(7, 'P', 'pending', 2), step(8, 'J', 'pending', 2),
    ]));
    expect(within(row).getByText(NA)).toBeTruthy();
    expect(within(row).queryByText(PENDING)).toBeNull();
  });

  it("'MAP 삭제' 경로도 같은 판정이다", () => {
    const row = openORow(makeDoc('MAP 삭제', [
      step(1, 'PL', 'approved', 1), step(2, 'P', 'rejected', 1), step(3, 'J', 'approved', 1),
      step(4, 'O', 'approved', 1),
      step(5, 'PL', 'approved', 2), step(6, 'P', 'pending', 2), step(7, 'J', 'pending', 2),
    ]));
    expect(within(row).getByText(NA)).toBeTruthy();
  });

  it('3구역이 열리기 전(PL 단계) 회차의 O 는 그대로 대기다', () => {
    const row = openORow(makeDoc('신규', [...round1, step(6, 'PL', 'pending', 2)]));
    expect(within(row).getByText(PENDING)).toBeTruthy();
    expect(within(row).queryByText(NA)).toBeNull();
  });
});
