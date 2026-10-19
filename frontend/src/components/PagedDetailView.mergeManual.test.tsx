/**
 * claude 수정 (2026-10-19): 결재 상세 — 변경전/변경후 표.
 * 참조 요청서 '없음' 문서는 작성 화면과 같이 layer 컬럼을 빼고 머리글을 '변경전'/'변경후'로 쓴다.
 * '있음' 문서는 종전대로 layer 컬럼과 '변경전 (참조 요청서)' 머리글을 쓴다.
 */
import React, { useState } from 'react';
import { render } from '@testing-library/react';
import PagedDetailView from './PagedDetailView';
import i18n from '../i18n';
import { RequestDocument } from '../types';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const DETAIL_TAB_IDX = 0;
const baseDetail = { request_purpose: '신규', line: 'line1', partid_selection: 'FP1', process_id: 'FPID1' };
const side = (pp: string) => ({ process_id: 'FPID1', sp: 'SP01', sd: 'SD01', pp, layerid: 'L01' });
const PAIR = { id: 'p1', table: 'J', beforeId: null, before: side('TEST1_OUT'), afterId: null, after: side('TEST1_IN'), kind: 'changed' };

const makeDoc = (detail: Record<string, unknown>): RequestDocument => ({
  id: 1,
  title: 'merge-manual-doc',
  requester_name: '이의뢰',
  requester_email: 'req@company.com',
  requester_department: 'dept',
  product_name: 'FP1',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: { ...baseDetail, ...detail }, history: [] }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-10-19T00:00:00Z',
  updated_at: '2026-10-19T00:00:00Z',
  submitted_at: '2026-10-19T00:00:00Z',
  approval_steps: [],
} as RequestDocument);

const Harness: React.FC<{ doc: RequestDocument }> = ({ doc }) => {
  const [pageIdx, setPageIdx] = useState(DETAIL_TAB_IDX);
  return <PagedDetailView doc={doc} role="PL" pageIdx={pageIdx} setPageIdx={setPageIdx} />;
};

const mergeTable = (container: HTMLElement) => {
  const table = container.querySelector('.ba-result-table');
  if (!table) throw new Error('변경전/변경후 표를 찾지 못했다');
  return {
    headers: Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent),
    cells: Array.from(table.querySelectorAll('tbody tr:first-child td')).map((td) => td.textContent),
  };
};

describe('결재 상세 — 변경전/변경후 표', () => {
  it("'없음' 문서는 layer 컬럼 없이 '변경전'/'변경후' 머리글을 쓴다", () => {
    const { container } = render(<Harness doc={makeDoc({ merge_ref_mode: 'none', merge_pairs: [PAIR] })} />);
    const { headers, cells } = mergeTable(container);
    expect(headers).toContain(i18n.t('request.ba_before_col_manual'));
    expect(headers).toContain(i18n.t('request.ba_after_col_manual'));
    expect(headers).not.toContain(i18n.t('request.col_layer'));
    expect(cells).not.toContain('L01');
    expect(cells).toHaveLength(10);
  });

  it("'있음' 문서는 종전대로 layer 컬럼과 '(참조 요청서)' 머리글을 쓴다", () => {
    const { container } = render(<Harness doc={makeDoc({ merge_ref_mode: 'ref', merge_pairs: [PAIR] })} />);
    const { headers, cells } = mergeTable(container);
    expect(headers).toContain(i18n.t('request.ba_before_col'));
    expect(headers.filter((h) => h === i18n.t('request.col_layer'))).toHaveLength(2);
    expect(cells.filter((c) => c === 'L01')).toHaveLength(2);
  });

  it('모드 값이 없는 예전 문서는 \'있음\'과 같이 그린다', () => {
    const { container } = render(<Harness doc={makeDoc({ merge_pairs: [PAIR] })} />);
    expect(mergeTable(container).headers).toContain(i18n.t('request.col_layer'));
  });
});
