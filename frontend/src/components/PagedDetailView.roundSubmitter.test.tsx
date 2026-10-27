/**
 * claude 수정 (2026-10-27): 결재 경로 탭 '상신자' 행 — 회차별 실제 상신자(round_submitters)를 표시한다.
 * 1회차는 A(의뢰자)가, 반려 후 2회차는 공유 그룹 멤버 B가 상신했다면 1회차 A / 2회차 B 로 보여야 하고,
 * 기록이 없는 회차(이 기능 이전 문서)는 의뢰자로 보여야 한다.
 */
import React, { useState } from 'react';
import { render, fireEvent } from '@testing-library/react';
import PagedDetailView from './PagedDetailView';
import i18n from '../i18n';
import { ApprovalStepFrontend, RequestDocument, RoundSubmitter } from '../types';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const DETAIL_TAB_IDX = 0;
const baseDetail = { request_purpose: '신규', line: 'line1', partid_selection: 'FP1', process_id: 'FPID1' };

const plStep = (id: number, round: number, action: ApprovalStepFrontend['action']): ApprovalStepFrontend => ({
  id, agent: 'PL', action, round, assignee_name: '검토PL', assignee_loginid: 'pl1',
  created_at: `2026-10-0${round}T00:00:00Z`, acted_at: null, comment: '', is_parallel: false,
} as ApprovalStepFrontend);

const makeDoc = (roundSubmitters?: RoundSubmitter[]): RequestDocument => ({
  id: 1,
  title: 'round-submitter-doc',
  requester_name: '작성자A',
  requester_email: 'a@company.com',
  requester_department: 'dept',
  product_name: 'FP1',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: baseDetail }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z',
  submitted_at: '2026-10-02T00:00:00Z',
  approval_steps: [plStep(1, 1, 'rejected'), plStep(2, 2, 'pending')],
  round_submitters: roundSubmitters,
} as RequestDocument);

const Harness: React.FC<{ doc: RequestDocument }> = ({ doc }) => {
  const [pageIdx, setPageIdx] = useState(DETAIL_TAB_IDX);
  return <PagedDetailView doc={doc} role="PL" pageIdx={pageIdx} setPageIdx={setPageIdx} />;
};

/** 결재 경로 탭으로 이동해 '상신자' 행의 회차별 텍스트를 돌려준다. */
const submitterRowItems = (container: HTMLElement): string[] => {
  fireEvent.click(Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.includes(i18n.t('approval.tab_route')),
  ) as HTMLButtonElement);
  const label = Array.from(container.querySelectorAll('div')).find(
    (d) => d.textContent === i18n.t('approval.label_requester') && d.children.length === 0,
  );
  if (!label?.nextElementSibling) throw new Error('상신자 행을 찾지 못했다');
  return Array.from(label.nextElementSibling.children).map((c) => c.textContent ?? '');
};

describe('결재 경로 탭 — 회차별 실제 상신자', () => {
  it('1회차는 A, 2회차는 B(공유 그룹 멤버)로 보인다', () => {
    const { container } = render(<Harness doc={makeDoc([
      { round: 1, submitter_loginid: 'a', submitter_name: '작성자A', submitter_email: 'a@company.com', submitted_at: '2026-10-01T00:00:00Z' },
      { round: 2, submitter_loginid: 'b', submitter_name: '그룹원B', submitter_email: 'b@company.com', submitted_at: '2026-10-02T00:00:00Z' },
    ])} />);
    const [r1, r2] = submitterRowItems(container);
    expect(r1).toContain('작성자A');
    expect(r1).toContain('a@company.com');
    expect(r2).toContain('그룹원B');
    expect(r2).toContain('b@company.com');
    expect(r2).not.toContain('작성자A');
  });

  it('기록이 없는 회차는 의뢰자로 보인다', () => {
    const { container } = render(<Harness doc={makeDoc([
      { round: 2, submitter_loginid: 'b', submitter_name: '그룹원B', submitter_email: 'b@company.com', submitted_at: '2026-10-02T00:00:00Z' },
    ])} />);
    const [r1, r2] = submitterRowItems(container);
    expect(r1).toContain('작성자A');
    expect(r2).toContain('그룹원B');
  });

  it('round_submitters 가 없는 예전 문서는 모든 회차가 의뢰자다', () => {
    const { container } = render(<Harness doc={makeDoc(undefined)} />);
    const items = submitterRowItems(container);
    expect(items).toHaveLength(2);
    items.forEach((text) => expect(text).toContain('작성자A'));
  });
});
