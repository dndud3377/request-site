/**
 * claude 수정 (2026-10-19): 탭별 '모든 이력 확인' — 탭 하나의 변경을 인접 회차 구간마다 모아 보여준다.
 * 값이 되돌아온 변경(A→B→A)·지워진 행·화면에 안 보이는 저장값 변경도 나온다.
 */
import React, { useState } from 'react';
import { render, fireEvent, within } from '@testing-library/react';
import PagedDetailView from './PagedDetailView';
import i18n from '../i18n';
import { RequestDocument } from '../types';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const TAB = { detail: 0, r: 1, jayer: 2, oayer: 3, bb: 4, etc: 5 } as const;
const base = { request_purpose: '신규', line: 'L_A', process_selection: 'PROC1', partid_selection: 'FP1', process_id: 'FPID1', map_type: 'NEW' };

const jrow = (id: string, layer: string) => ({
  id, updated: '20261001 10:00', sortOrder: 0, process_id: 'FPID1', sp: 'SP1', sd: 'SD1', pp: 'PP',
  layerid: layer, st: 'O', new_or_copy: '신규', product_name: 'FP1', step: `S_${layer}`, item_id: `IT_${layer}`,
});

const snap = (detail: Record<string, unknown>, ts: string, jayerRows: unknown[] = []) => ({
  detail: { ...base, ...detail }, jayerRows, oayerRows: [], bbRows: [], timestamp: ts,
});

const makeDoc = (detail: Record<string, unknown>, history: unknown[], jayerRows: unknown[] = []): RequestDocument => ({
  id: 1,
  title: 'all-history-doc',
  requester_name: '이의뢰',
  requester_email: 'req@company.com',
  requester_department: 'dept',
  product_name: 'FP1',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: { ...base, ...detail }, jayerRows, history }),
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

const allHistBtnText = () => `🕘 ${i18n.t('request.all_history_btn')}`;

/** 탭을 열고 '모든 이력 확인'을 눌러 열린 창(.modal) 을 돌려준다. */
const openAllHistory = (doc: RequestDocument, tab: number, historyMode?: boolean): HTMLElement => {
  const utils = render(<Harness doc={doc} tab={tab} historyMode={historyMode} />);
  fireEvent.click(utils.getByText(allHistBtnText()));
  const title = utils.getByText(i18n.t('request.all_history_title', { tab: '' }).trim(), { exact: false });
  const modal = title.closest('.modal') as HTMLElement | null;
  if (!modal) throw new Error('모든 이력 창을 찾지 못했다');
  return modal;
};

const section = (from: string, to: string) => i18n.t('request.all_history_section', { from, to });
const round = (n: number) => i18n.t('request.round_submit_label', { n });
const current = () => i18n.t('request.current_round_label');

describe('모든 이력 확인 — 버튼', () => {
  it.each(Object.entries(TAB))('%s 탭에 버튼이 하나 있다(이력 없는 문서도)', (_key, idx) => {
    const { getAllByText } = render(<Harness doc={makeDoc({}, [])} tab={idx} />);
    expect(getAllByText(allHistBtnText()).length).toBe(1);
  });

  it('이력이 없는 문서는 비교할 회차가 없다는 안내만 보인다', () => {
    const modal = openAllHistory(makeDoc({}, []), TAB.detail);
    expect(modal.textContent).toContain(i18n.t('request.all_history_no_rounds'));
  });

  it('창을 닫으면 사라진다', () => {
    const modal = openAllHistory(makeDoc({}, []), TAB.detail);
    fireEvent.click(within(modal).getByText('✕'));
    expect(document.body.textContent).not.toContain(i18n.t('request.all_history_no_rounds'));
  });
});

describe('모든 이력 확인 — 구간별 변경', () => {
  it('A→B→A 로 되돌아온 값도 두 구간 모두에 나온다(결재 진행 중 화면)', () => {
    const doc = makeDoc({ line: 'L_A' }, [snap({ line: 'L_A' }, '2026-10-01T00:00:00Z'), snap({ line: 'L_B' }, '2026-10-02T00:00:00Z')]);
    const modal = openAllHistory(doc, TAB.detail);
    const text = modal.textContent ?? '';
    expect(text).toContain(section(round(1), round(2)));
    expect(text).toContain(section(round(2), current()));
    const cells = Array.from(modal.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells.filter((c) => c === 'L_A').length).toBe(2);
    expect(cells.filter((c) => c === 'L_B').length).toBe(2);
  });

  it('그 탭이 바뀌지 않은 구간은 "변경 없음" 한 줄이다', () => {
    const doc = makeDoc({ line: 'L_B' }, [snap({ line: 'L_A' }, '2026-10-01T00:00:00Z'), snap({ line: 'L_B' }, '2026-10-02T00:00:00Z')]);
    const modal = openAllHistory(doc, TAB.detail);
    expect(within(modal).getAllByText(i18n.t('request.no_change_label')).length).toBe(1);
  });

  it('J-ayer 행의 신규·변경·삭제를 구분해 보여준다', () => {
    const prevRows = [jrow('j1', 'L01'), jrow('j2', 'L02'), jrow('j3', 'L03')];
    const curRows = [jrow('j1', 'L01X'), jrow('j3', 'L03'), jrow('j4', 'L04')];
    const modal = openAllHistory(makeDoc({}, [snap({}, '2026-10-01T00:00:00Z', prevRows)], curRows), TAB.jayer);
    const text = modal.textContent ?? '';
    expect(text).toContain(`${i18n.t('request.all_history_row_changed')}${i18n.t('request.all_history_row_no', { n: 1 })}`);
    expect(text).toContain(`${i18n.t('request.all_history_row_added')}${i18n.t('request.all_history_row_no', { n: 3 })}`);
    expect(text).toContain(`${i18n.t('request.all_history_row_removed')}${i18n.t('request.all_history_prev_row_no', { n: 2 })}`);
    const cells = Array.from(modal.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toEqual(expect.arrayContaining(['L01', 'L01X', 'L02', 'L04']));
    expect(cells).not.toContain('L03');
  });

  it('화면에 안 보이는 저장값(MAP 목적 NEW 의 원본 라인)이 바뀌어도 나온다', () => {
    const doc = makeDoc({ source_line: 'SRC_NEW' }, [snap({ source_line: 'SRC_OLD' }, '2026-10-01T00:00:00Z')]);
    const modal = openAllHistory(doc, TAB.r);
    const cells = Array.from(modal.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toEqual(expect.arrayContaining([i18n.t('request.source_line'), 'SRC_OLD', 'SRC_NEW']));
  });

  it('새로 추적하는 Inter 변경도 R 탭 창에 나온다', () => {
    const doc = makeDoc({ inter: 'NO' }, [snap({ inter: 'YES', inter_ys: '적용' }, '2026-10-01T00:00:00Z')]);
    const modal = openAllHistory(doc, TAB.r);
    const cells = Array.from(modal.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toEqual(expect.arrayContaining([
      i18n.t('request.map_opt_inter'),
      `${i18n.t('approval.inter_applied')} / ${i18n.t('approval.inter_ys_applied')}`,
    ]));
  });

  it('기타 탭은 비교할 항목이 없어 구간마다 "변경 없음"이다', () => {
    const doc = makeDoc({ line: 'L_B' }, [snap({ line: 'L_A' }, '2026-10-01T00:00:00Z')]);
    const modal = openAllHistory(doc, TAB.etc);
    expect(within(modal).getAllByText(i18n.t('request.no_change_label')).length).toBe(1);
  });

  it('이력 조회 화면에서도 같은 창이 열린다', () => {
    const doc = makeDoc({ line: 'L_B' }, [snap({ line: 'L_A' }, '2026-10-01T00:00:00Z')]);
    const modal = openAllHistory(doc, TAB.detail, true);
    const cells = Array.from(modal.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toEqual(expect.arrayContaining(['L_A', 'L_B']));
  });
});
