/**
 * 결재 경로 탭 — 영업/기술지원 합의자(SA) 행의 '합의자 미지정 사유' 회차별 표시.
 *
 * 서버가 회차별로 기록한 `sales_agreer_none_reasons` 를 그 회차의 SA 행에 그대로 보여준다.
 * (예: 1회차 사유 → 2회차 사유 없음 → 3회차 새 사유 ⇒ 1·3회차에만 보인다)
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PagedDetailView from './PagedDetailView';
import i18n from '../i18n';
import { RequestDocument, ApprovalStepFrontend } from '../types';

const SA_LABEL = i18n.t('approval.agent_SA');
const reasonText = (reason: string) => i18n.t('approval.sales_agreer_none_reason_label', { reason });

const plStep = (id: number, round: number, action: ApprovalStepFrontend['action']): ApprovalStepFrontend => ({
  id, agent: 'PL', action, acted_at: action === 'approved' ? '2026-09-21T01:00:00Z' : null,
  assignee_name: '김지정', round,
});

const makeDoc = (overrides: Partial<RequestDocument> = {}): RequestDocument => ({
  id: 1,
  title: 'sa-reason-doc',
  requester_name: '이의뢰',
  requester_email: 'req@company.com',
  requester_department: 'dept',
  product_name: 'PROD-1',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: { request_purpose: '신규' } }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-09-21T00:00:00Z',
  updated_at: '2026-10-05T00:00:00Z',
  submitted_at: '2026-10-05T00:00:00Z',
  approval_steps: [plStep(1, 1, 'approved'), plStep(2, 2, 'approved'), plStep(3, 3, 'pending')],
  ...overrides,
});

const Harness: React.FC<{ doc: RequestDocument }> = ({ doc }) => {
  const [pageIdx, setPageIdx] = useState(0);
  return <PagedDetailView doc={doc} role="PL" pageIdx={pageIdx} setPageIdx={setPageIdx} />;
};

/** 결재 경로 탭을 열고 SA 행(라벨 + 회차별 목록)을 돌려준다. */
const openSaRow = (doc: RequestDocument): HTMLElement => {
  render(<Harness doc={doc} />);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('approval.tab_route') }));
  return screen.getByText(SA_LABEL).parentElement as HTMLElement;
};

describe('결재 경로 탭 — SA 행 미지정 사유', () => {
  it('합의자가 없는 회차에는 그 회차의 사유를 보여주고, 사유가 없는 회차는 해당없음만 보인다', () => {
    const row = openSaRow(makeDoc({ sales_agreer_none_reasons: { '1': 'XXX', '3': 'XXXX' } }));
    const na = i18n.t('approval.step_na');

    expect(within(row).getAllByText(na)).toHaveLength(3);
    expect(within(row).getByText(`"${reasonText('XXX')}"`)).toBeTruthy();
    expect(within(row).getByText(`"${reasonText('XXXX')}"`)).toBeTruthy();
    expect(within(row).queryAllByText(/^"/)).toHaveLength(2);
  });

  it('회차별 기록이 없으면(기존 문서 등) 사유 없이 해당없음만 보인다', () => {
    const row = openSaRow(makeDoc());
    expect(within(row).getAllByText(i18n.t('approval.step_na'))).toHaveLength(3);
    expect(within(row).queryAllByText(/^"/)).toHaveLength(0);
  });

  it('그 회차에 SA 단계가 실제로 있으면 사유 대신 단계 정보를 보여준다', () => {
    const saStep: ApprovalStepFrontend = {
      id: 10, agent: 'SA', action: 'pending', acted_at: null, assignee_name: '박합의', round: 3,
    };
    const row = openSaRow(makeDoc({
      approval_steps: [plStep(1, 1, 'approved'), plStep(2, 2, 'approved'), plStep(3, 3, 'pending'), saStep],
      sales_agreer_none_reasons: { '1': 'XXX', '3': 'XXXX' },
    }));

    expect(within(row).getByText('박합의')).toBeTruthy();
    expect(within(row).queryByText(`"${reasonText('XXXX')}"`)).toBeNull();
    expect(within(row).getByText(`"${reasonText('XXX')}"`)).toBeTruthy();
  });
});
