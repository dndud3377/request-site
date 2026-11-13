/**
 * claude 수정 (2026-11-13): 결재 경로 탭 — 2구역 System R(RS) 행.
 *
 * 일반·Only MAP 경로는 2구역에 R 과 병렬로 System R 이 있다(백엔드 system_r.py). RS step 이 있으면 그 상태를,
 * 아직 R 도 없으면(PL 단계) '대기', R 은 있는데 RS 가 없는 회차(System R 도입 전 문서)는 '해당없음'을 보여 준다.
 * MAP 삭제·ADI CD 변경은 RS 가 없어 '해당없음'이다.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PagedDetailView from './PagedDetailView';
import i18n from '../i18n';
import { RequestDocument, ApprovalStepFrontend } from '../types';

const RS_LABEL = i18n.t('approval.agent_RS');
const NA = i18n.t('approval.step_na');
const PENDING = i18n.t('approval.step_pending');
const UNASSIGNED = i18n.t('approval.step_unassigned');
const AGREE = i18n.t('approval.agree');

const plStep: ApprovalStepFrontend = {
  id: 1, agent: 'PL', action: 'pending', acted_at: null, assignee_name: '김지정', round: 1,
};
const plDone: ApprovalStepFrontend = { ...plStep, action: 'approved', acted_at: '2026-11-13T01:00:00Z' };
const rStep: ApprovalStepFrontend = { id: 2, agent: 'R', action: 'pending', acted_at: null, round: 1 };
const rsStep: ApprovalStepFrontend = { id: 3, agent: 'RS', action: 'pending', acted_at: null, round: 1 };

const makeDoc = (purpose: string, steps: ApprovalStepFrontend[]): RequestDocument => ({
  id: 1,
  title: 'system-r-route-doc',
  requester_name: '이의뢰',
  requester_email: 'req@company.com',
  requester_department: 'dept',
  product_name: 'PROD-1',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: { request_purpose: purpose } }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-11-13T00:00:00Z',
  updated_at: '2026-11-13T00:00:00Z',
  submitted_at: '2026-11-13T00:00:00Z',
  approval_steps: steps,
});

const Harness: React.FC<{ doc: RequestDocument }> = ({ doc }) => {
  const [pageIdx, setPageIdx] = useState(0);
  return <PagedDetailView doc={doc} role="PL" pageIdx={pageIdx} setPageIdx={setPageIdx} />;
};

/** 결재 경로 탭을 열고 System R 행(라벨 + 회차별 목록)을 돌려준다. 첫 번째 'System R' 텍스트가 행 라벨이다. */
const openRsRow = (doc: RequestDocument): HTMLElement => {
  render(<Harness doc={doc} />);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('approval.tab_route') }));
  return screen.getAllByText(RS_LABEL)[0].parentElement as HTMLElement;
};

describe('결재 경로 탭 — 2구역 System R 행', () => {
  it('PL 단계(R·RS 아직 없음)에는 대기로 보인다', () => {
    const row = openRsRow(makeDoc('신규', [plStep]));
    expect(within(row).getByText(PENDING)).toBeTruthy();
  });

  it('RS 가 생성돼 판정 대기 중이면 대기중으로 보인다', () => {
    const row = openRsRow(makeDoc('신규', [plDone, rStep, rsStep]));
    expect(within(row).getByText(UNASSIGNED)).toBeTruthy();
  });

  it('System R 이 합의하면 합의 + 처리자 System R + 의견을 보여 준다', () => {
    const done: ApprovalStepFrontend = {
      ...rsStep, action: 'approved', acted_at: '2026-11-13T02:00:00Z',
      acted_by_name: 'System R', comment: '[System R 합의]',
    };
    const row = openRsRow(makeDoc('Only MAP', [plDone, rStep, done]));
    expect(within(row).getByText(AGREE)).toBeTruthy();
    // 행 라벨과 처리자 이름이 모두 'System R' 이다
    expect(within(row).getAllByText('System R')).toHaveLength(2);
    expect(within(row).getByText('"[System R 합의]"')).toBeTruthy();
  });

  it('R 은 있는데 RS 가 없는 회차(System R 도입 전 문서)는 해당없음이다', () => {
    const row = openRsRow(makeDoc('신규', [plDone, rStep]));
    expect(within(row).getByText(NA)).toBeTruthy();
    expect(within(row).queryByText(PENDING)).toBeNull();
  });

  it('MAP 삭제·ADI CD 변경 문서는 해당없음이다', () => {
    const row = openRsRow(makeDoc('MAP 삭제', [plStep]));
    expect(within(row).getByText(NA)).toBeTruthy();
  });
});
