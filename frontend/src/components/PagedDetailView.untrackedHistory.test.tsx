/**
 * claude 수정 (2026-10-19): 이력 추적이 없던 항목(Inter·MAP 삭제 이유·ADI CD 스텝/적용 대상·병합 결과)에
 * 변경 강조 + '이력 확인' 을 붙였다. 화면 표시값으로 비교하므로 화면에 안 보이는 잔여 값은 변경이 아니다.
 */
import React, { useState } from 'react';
import { render, fireEvent, within } from '@testing-library/react';
import PagedDetailView from './PagedDetailView';
import i18n from '../i18n';
import { RequestDocument } from '../types';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const DETAIL_TAB_IDX = 0;
const R_TAB_IDX = 1;
const PREV_TS = '2026-10-01T00:00:00Z';
const base = { request_purpose: '신규', line: 'line1', process_selection: 'PROC1', partid_selection: 'FP1', process_id: 'FPID1', map_type: 'NEW' };
const ADI = 'ADI CD 변경';

const snap = (detail: Record<string, unknown>) => ({ detail: { ...base, ...detail }, jayerRows: [], oayerRows: [], bbRows: [], timestamp: PREV_TS });

const makeDoc = (detail: Record<string, unknown>, history: Record<string, unknown>[]): RequestDocument => ({
  id: 1,
  title: 'untracked-history-doc',
  requester_name: '이의뢰',
  requester_email: 'req@company.com',
  requester_department: 'dept',
  product_name: 'FP1',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: { ...base, ...detail }, history }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-10-19T00:00:00Z',
  updated_at: '2026-10-19T00:00:00Z',
  submitted_at: '2026-10-19T00:00:00Z',
  approval_steps: [],
} as RequestDocument);

const Harness: React.FC<{ doc: RequestDocument; tab: number; historyMode?: boolean }> = ({ doc, tab, historyMode }) => {
  const [pageIdx, setPageIdx] = useState(tab);
  return <PagedDetailView doc={doc} role="PL" pageIdx={pageIdx} setPageIdx={setPageIdx} historyMode={historyMode} />;
};

const histBtns = (root: HTMLElement) => within(root).queryAllByText(i18n.t('request.history_check_btn'));
const modalText = (): string => document.body.textContent ?? '';

const pair = (table: 'J' | 'O', beforeLayer: string, afterLayer: string) => ({
  id: `p_${beforeLayer}`, table, beforeId: 'b1', afterId: 'a1', kind: 'changed',
  before: { process_id: 'FPID1', sp: 'SP', sd: 'SD', pp: 'PP', layerid: beforeLayer },
  after: { process_id: 'FPID1', sp: 'SP', sd: 'SD', pp: 'PP', layerid: afterLayer },
});

describe('Inter(3번) 이력', () => {
  it('YES → NO 로 바뀌면 이력 확인이 뜨고, 모달에 이전 표시 문구가 보인다', () => {
    const doc = makeDoc({ inter: 'NO' }, [snap({ inter: 'YES', inter_xs: '적용' })]);
    const { container } = render(<Harness doc={doc} tab={R_TAB_IDX} />);
    const btns = histBtns(container);
    expect(btns.length).toBe(1);
    fireEvent.click(btns[0]);
    expect(modalText()).toContain(`${i18n.t('approval.inter_applied')} / ${i18n.t('approval.inter_xs_applied')}`);
  });

  it('NO 인 채로 화면에 안 보이는 잔여 값(inter_xs)만 다르면 변경이 아니다', () => {
    const doc = makeDoc({ inter: 'NO', inter_xs: '' }, [snap({ inter: 'NO', inter_xs: '적용' })]);
    const { container } = render(<Harness doc={doc} tab={R_TAB_IDX} />);
    expect(histBtns(container).length).toBe(0);
  });

  it('이력 조회에서는 A→B→A 로 되돌아와도 이력 확인이 뜬다', () => {
    const doc = makeDoc({ inter: 'NO' }, [snap({ inter: 'NO' }), snap({ inter: 'YES' })]);
    const { container } = render(<Harness doc={doc} tab={R_TAB_IDX} historyMode />);
    expect(histBtns(container).length).toBe(1);
  });
});

describe('MAP 삭제 이유 이력', () => {
  it('빨간 테두리와 함께 이력 확인이 뜨고, 모달은 서식을 뺀 글자로 보여준다', () => {
    const doc = makeDoc(
      { map_type: '삭제', map_change_reason: '<p>새 <b>사유</b></p>' },
      [snap({ map_type: '삭제', map_change_reason: '<p>옛 사유</p>' })],
    );
    const { container } = render(<Harness doc={doc} tab={R_TAB_IDX} />);
    const btns = histBtns(container);
    expect(btns.length).toBe(1);
    fireEvent.click(btns[0]);
    const cells = Array.from(document.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toContain('옛 사유');
    expect(cells).toContain('새 사유');
  });
});

describe('ADI CD 카드 이력', () => {
  const step = (id: string, stepId: string) => ({ id, step_id: stepId, step_desc: `${stepId} 설명` });

  it('스텝이 바뀌면 이력 확인이 뜨고 변경 전/후 표가 보인다', () => {
    const doc = makeDoc(
      { request_purpose: ADI, adi_cd_before: [step('a1', 'STEP_B')], adi_cd_after: [step('b1', 'STEP_B2')] },
      [snap({ request_purpose: ADI, adi_cd_before: [step('a1', 'STEP_A')], adi_cd_after: [step('b1', 'STEP_A2')] })],
    );
    const { container } = render(<Harness doc={doc} tab={DETAIL_TAB_IDX} />);
    const btns = histBtns(container);
    expect(btns.length).toBe(1);
    fireEvent.click(btns[0]);
    const cells = Array.from(document.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toEqual(expect.arrayContaining(['STEP_A', 'STEP_B', 'STEP_A2', 'STEP_B2']));
  });

  it('스텝 id 만 다르고 화면 값이 같으면 변경이 아니다', () => {
    const doc = makeDoc(
      { request_purpose: ADI, adi_cd_before: [step('new1', 'STEP_A')], adi_cd_after: [step('new2', 'STEP_A2')] },
      [snap({ request_purpose: ADI, adi_cd_before: [step('a1', 'STEP_A')], adi_cd_after: [step('b1', 'STEP_A2')] })],
    );
    const { container } = render(<Harness doc={doc} tab={DETAIL_TAB_IDX} />);
    expect(histBtns(container).length).toBe(0);
  });

  it('동일 변경 적용 대상이 바뀌면 이력 확인이 뜬다', () => {
    const doc = makeDoc(
      { request_purpose: ADI, adi_cd_extra_targets: [{ partid_selection: 'FP9', process_id: 'FPID9' }] },
      [snap({ request_purpose: ADI, adi_cd_extra_targets: [{ partid_selection: 'FP2', process_id: 'FPID2' }] })],
    );
    const { container } = render(<Harness doc={doc} tab={DETAIL_TAB_IDX} />);
    const btns = histBtns(container);
    expect(btns.length).toBe(1);
    fireEvent.click(btns[0]);
    const cells = Array.from(document.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toEqual(expect.arrayContaining(['FP2', 'FP9']));
  });
});

describe('병합 결과 이력', () => {
  it('짝의 값이 바뀌면 이력 확인이 뜨고 이전 값이 보인다', () => {
    const doc = makeDoc({ merge_pairs: [pair('J', 'L01', 'L09')] }, [snap({ merge_pairs: [pair('J', 'L01', 'L02')] })]);
    const { container } = render(<Harness doc={doc} tab={DETAIL_TAB_IDX} />);
    const btns = histBtns(container);
    expect(btns.length).toBe(1);
    fireEvent.click(btns[0]);
    const cells = Array.from(document.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toEqual(expect.arrayContaining(['L02', 'L09']));
  });

  it('이전 회차와 같으면 이력 확인이 뜨지 않는다', () => {
    const doc = makeDoc({ merge_pairs: [pair('J', 'L01', 'L02')] }, [snap({ merge_pairs: [pair('J', 'L01', 'L02')] })]);
    const { container } = render(<Harness doc={doc} tab={DETAIL_TAB_IDX} />);
    expect(histBtns(container).length).toBe(0);
  });
});
