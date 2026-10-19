/**
 * claude 수정 (2026-10-19): 결재 경로 탭 — 'Overlay만 변경' 단독 문서의 R(RFG) 행.
 *
 * 이 문서는 J 와 함께 2구역(R)도 거치지 않는다(백엔드 skip_r_stage). PL 단계부터 R 행이
 * '대기중'이 아니라 '해당없음'이어야 하고, R 이 이미 생성된 진행 중 문서는 R 단계를 그대로 보여준다.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PagedDetailView from './PagedDetailView';
import i18n from '../i18n';
import { RequestDocument, ApprovalStepFrontend } from '../types';

const R_LABEL = i18n.t('approval.agent_R');
const NA = i18n.t('approval.step_na');
const PENDING = i18n.t('approval.step_pending');

const plStep: ApprovalStepFrontend = {
  id: 1, agent: 'PL', action: 'pending', acted_at: null, assignee_name: '김지정', round: 1,
};

const makeDoc = (otherPurpose: string[], steps: ApprovalStepFrontend[]): RequestDocument => ({
  id: 1,
  title: 'overlay-route-doc',
  requester_name: '이의뢰',
  requester_email: 'req@company.com',
  requester_department: 'dept',
  product_name: 'PROD-1',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: { request_purpose: '신규', other_purpose: otherPurpose } }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-10-19T00:00:00Z',
  updated_at: '2026-10-19T00:00:00Z',
  submitted_at: '2026-10-19T00:00:00Z',
  approval_steps: steps,
});

const Harness: React.FC<{ doc: RequestDocument }> = ({ doc }) => {
  const [pageIdx, setPageIdx] = useState(0);
  return <PagedDetailView doc={doc} role="PL" pageIdx={pageIdx} setPageIdx={setPageIdx} />;
};

/** 결재 경로 탭을 열고 R 행(라벨 + 회차별 목록)을 돌려준다. */
const openRRow = (doc: RequestDocument): HTMLElement => {
  render(<Harness doc={doc} />);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('approval.tab_route') }));
  return screen.getByText(R_LABEL).parentElement as HTMLElement;
};

describe("결재 경로 탭 — 'Overlay만 변경' 단독 문서의 R 행", () => {
  it('PL 단계(R step 없음)부터 R 행은 해당없음이다', () => {
    const row = openRRow(makeDoc(['Overlay만 변경'], [plStep]));
    expect(within(row).getByText(NA)).toBeTruthy();
    expect(within(row).queryByText(PENDING)).toBeNull();
  });

  it("구 저장값 'Overlay 변경' 단독 문서도 같은 판정이다", () => {
    const row = openRRow(makeDoc(['Overlay 변경'], [plStep]));
    expect(within(row).getByText(NA)).toBeTruthy();
  });

  it('R 이 이미 생성된 진행 중 문서는 R 단계를 그대로 보여준다', () => {
    const rStep: ApprovalStepFrontend = {
      id: 2, agent: 'R', action: 'pending', acted_at: null, assignee_name: '최RFG', round: 1,
    };
    const row = openRRow(makeDoc(['Overlay만 변경'], [{ ...plStep, action: 'approved' }, rStep]));
    expect(within(row).getByText('최RFG')).toBeTruthy();
    expect(within(row).queryByText(NA)).toBeNull();
  });

  it('다른 목적과 함께 고른 문서(일반 경로)는 PL 단계에서 R 행이 대기중이다', () => {
    const row = openRRow(makeDoc(['Overlay만 변경', 'STEPSEQ 변경'], [plStep]));
    expect(within(row).getByText(PENDING)).toBeTruthy();
    expect(within(row).queryByText(NA)).toBeNull();
  });
});
