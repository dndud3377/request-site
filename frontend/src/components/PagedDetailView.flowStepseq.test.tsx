/**
 * claude 수정 (2026-10-16): 결재 상세 — 흐름도 표 Step 칸에 stepseq 를 작은 회색 글씨로, 이력 확인 창에는 일반 글씨로 함께 보여준다.
 * stepseq 가 없는 예전 문서 행은 Layer ID 만 보인다.
 */
import React, { useState } from 'react';
import { render, fireEvent } from '@testing-library/react';
import PagedDetailView from './PagedDetailView';
import i18n from '../i18n';
import { RequestDocument } from '../types';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const DETAIL_TAB_IDX = 0;
const baseDetail = { request_purpose: '신규', line: 'line1', partid_selection: 'FP1', process_id: 'FPID1' };
const newRow = { id: 'f1', location: 'line1', product_name: 'FP1', process_id: 'FPID1', step_from: 'L01', step_to: 'L03', step_from_seq: 'AAAA1234', step_to_seq: 'AAAA1238' };
const oldRow = { id: 'f2', location: 'line1', product_name: 'FP1', process_id: 'FPID1', step_from: 'L09', step_to: 'L10' };

const makeDoc = (flow: unknown[], history: Record<string, unknown>[] = []): RequestDocument => ({
  id: 1,
  title: 'flow-seq-doc',
  requester_name: '이의뢰',
  requester_email: 'req@company.com',
  requester_department: 'dept',
  product_name: 'FP1',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: { ...baseDetail, flow_chart: flow }, history }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-10-16T00:00:00Z',
  updated_at: '2026-10-16T00:00:00Z',
  submitted_at: '2026-10-16T00:00:00Z',
  approval_steps: [],
} as RequestDocument);

const Harness: React.FC<{ doc: RequestDocument }> = ({ doc }) => {
  const [pageIdx, setPageIdx] = useState(DETAIL_TAB_IDX);
  return <PagedDetailView doc={doc} role="PL" pageIdx={pageIdx} setPageIdx={setPageIdx} />;
};

const flowTableRows = (container: HTMLElement): HTMLTableRowElement[] => {
  const tables = Array.from(container.querySelectorAll('table'));
  const flowTable = tables.find((tb) => tb.querySelector('th')?.textContent === i18n.t('request.flow_line'));
  if (!flowTable) throw new Error('흐름도 표를 찾지 못했다');
  return Array.from(flowTable.querySelectorAll('tbody tr'));
};

describe('결재 상세 흐름도 — Step stepseq 표시', () => {
  it('stepseq 가 있으면 Layer 뒤에 작은 회색 글씨로, 없으면 Layer 만 보인다', () => {
    const { container } = render(<Harness doc={makeDoc([newRow, oldRow])} />);
    const [r1, r2] = flowTableRows(container);
    const stepCell1 = r1.querySelectorAll('td')[3];
    expect(Array.from(stepCell1.querySelectorAll('.flow-step-seq')).map((s) => s.textContent)).toEqual(['AAAA1234', 'AAAA1238']);
    expect(stepCell1.textContent).toBe('L01AAAA1234 ~ L03AAAA1238');
    const stepCell2 = r2.querySelectorAll('td')[3];
    expect(stepCell2.querySelectorAll('.flow-step-seq').length).toBe(0);
    expect(stepCell2.textContent).toBe('L09 ~ L10');
  });

  it('이력 확인 창의 Step 칸은 "L01 (AAAA1234) ~ L03 (AAAA1238)" 처럼 일반 글씨로 보인다', () => {
    const prev = { detail: { ...baseDetail, flow_chart: [oldRow] }, jayerRows: [], oayerRows: [], bbRows: [], timestamp: '2026-10-15T00:00:00Z' };
    const { getAllByText } = render(<Harness doc={makeDoc([newRow], [prev])} />);
    fireEvent.click(getAllByText(i18n.t('request.history_check_btn'))[0]);
    const cells = Array.from(document.querySelectorAll('td')).map((td) => td.textContent ?? '');
    expect(cells).toContain('L01 (AAAA1234) ~ L03 (AAAA1238)');
    expect(cells).toContain('L09 ~ L10');
  });
});
