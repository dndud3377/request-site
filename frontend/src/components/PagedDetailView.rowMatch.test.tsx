/**
 * claude 수정 (2026-10-21): J/O 표를 다시 조회해 행 id 가 전부 바뀐 회차의 행 짝짓기.
 * 겹치는 id 가 하나도 없으면 위치 대신 process_id+PP → process_id+Layer 로 짝짓고, 그래도 없으면 신규/삭제로 본다.
 * (종전 위치 폴백은 중간에 행이 끼어들면 그 아래 행이 한 칸씩 밀려 전부 '변경'으로 잡혔다.)
 * 뼈찜 표는 이번 규칙 대상이 아니라 위치 폴백을 유지한다.
 */
import React, { useState } from 'react';
import { render, fireEvent, within, RenderResult } from '@testing-library/react';
import PagedDetailView from './PagedDetailView';
import i18n from '../i18n';
import { RequestDocument } from '../types';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const TAB = { jayer: 2, oayer: 3, bb: 4 } as const;
const base = { request_purpose: '신규', line: 'L_A', process_selection: 'PROC1', partid_selection: 'FP1', process_id: 'FPID1', map_type: 'NEW' };

type LayerRowSeed = { id: string; sp: string; pp: string; layerid: string };

const layerRow = ({ id, sp, pp, layerid }: LayerRowSeed) => ({
  id, updated: '20261001 10:00', sortOrder: 0, process_id: 'FPID1', sp, sd: `SD_${sp}`, pp,
  layerid, st: 'O', new_or_copy: '신규', product_name: 'FP1', step: '', item_id: '',
});

const bbRow = (id: string, bbName: string) => ({
  id, sortOrder: 0, disabled: false, process_id: 'FPID1', ss: 'SS1', sd: 'SD1',
  bb_process_id: 'BBP', bb_name: bbName, bb_layer: 'BL', bb_ss: 'BS', bb_step: 'BST', remark: '',
});

type Tables = { jayerRows?: unknown[]; oayerRows?: unknown[]; bbRows?: unknown[] };

const makeDoc = (prev: Tables, cur: Tables): RequestDocument => ({
  id: 1,
  title: 'row-match-doc',
  requester_name: '이의뢰',
  requester_email: 'req@company.com',
  requester_department: 'dept',
  product_name: 'FP1',
  reference_materials: '',
  additional_notes: JSON.stringify({
    detail: base,
    jayerRows: cur.jayerRows ?? [],
    oayerRows: cur.oayerRows ?? [],
    bbRows: cur.bbRows ?? [],
    history: [{
      detail: base,
      jayerRows: prev.jayerRows ?? [],
      oayerRows: prev.oayerRows ?? [],
      bbRows: prev.bbRows ?? [],
      timestamp: '2026-10-07T11:32:57Z',
    }],
  }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-12T00:00:00Z',
  submitted_at: '2026-10-12T00:00:00Z',
  approval_steps: [],
} as RequestDocument);

const Harness: React.FC<{ doc: RequestDocument; tab: number; historyMode?: boolean }> = ({ doc, tab, historyMode }) => {
  const [pageIdx, setPageIdx] = useState(tab);
  return <PagedDetailView doc={doc} role="PL" pageIdx={pageIdx} setPageIdx={setPageIdx} historyMode={historyMode} />;
};

/** 표 행의 '이력 확인' 버튼(= 변경으로 강조된 행)들 */
const histButtons = (utils: RenderResult): HTMLElement[] =>
  utils.queryAllByRole('button', { name: i18n.t('request.history_check_btn') });

/** '이력 확인' 버튼이 달린 행의 PP 값 — 표에서 PP 는 6번째 데이터 칸(버튼 칸 포함 7번째)이다. */
const flaggedPps = (utils: RenderResult): string[] =>
  histButtons(utils).map((b) => (b.closest('tr') as HTMLElement).querySelectorAll('td')[6].textContent ?? '');

const openModal = (button: HTMLElement): HTMLElement => {
  fireEvent.click(button);
  const modal = document.querySelector('.modal') as HTMLElement | null;
  if (!modal) throw new Error('이력 모달을 찾지 못했다');
  return modal;
};

const noneMark = () => `(${i18n.t('request.value_none')})`;

// 2차 회차(이전) — 5.30 ~ 5.80, 6행
const PREV_SEEDS: LayerRowSeed[] = [
  { id: 'p1', sp: '5.30', pp: 'RCP_A', layerid: '10' },
  { id: 'p2', sp: '5.40', pp: 'RCP_B', layerid: '20' },
  { id: 'p3', sp: '5.50', pp: 'RCP_C', layerid: '30' },
  { id: 'p4', sp: '5.60', pp: 'RCP_D', layerid: '40' },
  { id: 'p5', sp: '5.70', pp: 'RCP_E', layerid: '50' },
  { id: 'p6', sp: '5.80', pp: 'RCP_F', layerid: '60' },
];
// 3차 회차(현재) — 다시 조회돼 id 가 전부 새것이고, 중간에 5.55 / 5.65 두 행이 끼어들었다.
const CUR_SEEDS: LayerRowSeed[] = [
  { id: 'n1', sp: '5.30', pp: 'RCP_A', layerid: '10' },
  { id: 'n2', sp: '5.40', pp: 'RCP_B', layerid: '20' },
  { id: 'n3', sp: '5.50', pp: 'RCP_C', layerid: '30' },
  { id: 'n4', sp: '5.55', pp: 'RCP_N1', layerid: '55' },
  { id: 'n5', sp: '5.60', pp: 'RCP_D', layerid: '40' },
  { id: 'n6', sp: '5.65', pp: 'RCP_N2', layerid: '65' },
  { id: 'n7', sp: '5.70', pp: 'RCP_E', layerid: '50' },
  { id: 'n8', sp: '5.80', pp: 'RCP_F', layerid: '60' },
];
const prevRows = PREV_SEEDS.map(layerRow);
const curRows = CUR_SEEDS.map(layerRow);

describe('J-ayer — id 가 전부 바뀐 회차(표 재조회)', () => {
  it('중간에 끼어든 2행만 강조되고, 아래 행은 밀려 비교되지 않는다', () => {
    const utils = render(<Harness doc={makeDoc({ jayerRows: prevRows }, { jayerRows: curRows })} tab={TAB.jayer} />);
    expect(flaggedPps(utils)).toEqual(['RCP_N1', 'RCP_N2']);
  });

  it('끼어든 행의 이력은 변경 전 = (없음) 이다', () => {
    const utils = render(<Harness doc={makeDoc({ jayerRows: prevRows }, { jayerRows: curRows })} tab={TAB.jayer} />);
    const modal = openModal(histButtons(utils)[0]);
    const cells = Array.from(modal.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toContain(noneMark());
    expect(cells).not.toContain('RCP_D');
  });

  it('PP 만 바뀐 행은 Layer 로 짝지어 "변경"으로 보이고, 이력에 PP 전/후가 나온다', () => {
    const cur = CUR_SEEDS.map((s) => (s.id === 'n7' ? { ...s, pp: 'RCP_E2' } : s)).map(layerRow);
    const utils = render(<Harness doc={makeDoc({ jayerRows: prevRows }, { jayerRows: cur })} tab={TAB.jayer} />);
    expect(flaggedPps(utils)).toEqual(['RCP_N1', 'RCP_N2', 'RCP_E2']);
    const modal = openModal(histButtons(utils)[2]);
    const cells = Array.from(modal.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toEqual(expect.arrayContaining(['RCP_E', 'RCP_E2']));
    expect(cells).not.toContain(noneMark());
  });

  it('PP 가 빈 행끼리는 짝짓지 않는다(Layer 도 다르면 신규)', () => {
    const prev = [layerRow({ id: 'p1', sp: '5.30', pp: '', layerid: '10' })];
    const cur = [layerRow({ id: 'n1', sp: '5.30', pp: '', layerid: '20' })];
    const utils = render(<Harness doc={makeDoc({ jayerRows: prev }, { jayerRows: cur })} tab={TAB.jayer} />);
    const modal = openModal(histButtons(utils)[0]);
    const cells = Array.from(modal.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toContain(noneMark());
  });

  it('같은 PP 가 여럿이면 등장 순서대로 하나씩 짝짓는다', () => {
    const prev = [
      layerRow({ id: 'p1', sp: '5.30', pp: 'RCP_X', layerid: '10' }),
      layerRow({ id: 'p2', sp: '5.40', pp: 'RCP_X', layerid: '20' }),
    ];
    const cur = [
      layerRow({ id: 'n1', sp: '5.30', pp: 'RCP_X', layerid: '10' }),
      layerRow({ id: 'n2', sp: '5.40', pp: 'RCP_X', layerid: '20' }),
    ];
    const utils = render(<Harness doc={makeDoc({ jayerRows: prev }, { jayerRows: cur })} tab={TAB.jayer} />);
    expect(histButtons(utils)).toHaveLength(0);
  });

  it('이력 조회 화면(historyMode)에서도 끼어든 2행만 강조된다', () => {
    const utils = render(<Harness doc={makeDoc({ jayerRows: prevRows }, { jayerRows: curRows })} tab={TAB.jayer} historyMode />);
    expect(flaggedPps(utils)).toEqual(['RCP_N1', 'RCP_N2']);
  });

  it("'모든 이력 확인'에 신규 2행과, 짝이 없는 이전 행의 삭제만 나온다", () => {
    const cur = curRows.filter((r) => r.pp !== 'RCP_C');
    const utils = render(<Harness doc={makeDoc({ jayerRows: prevRows }, { jayerRows: cur })} tab={TAB.jayer} />);
    fireEvent.click(utils.getByText(`🕘 ${i18n.t('request.all_history_btn')}`));
    const title = utils.getByText(i18n.t('request.all_history_title', { tab: '' }).trim(), { exact: false });
    const text = (title.closest('.modal') as HTMLElement).textContent ?? '';
    expect(text).toContain(`${i18n.t('request.all_history_row_added')}${i18n.t('request.all_history_row_no', { n: 3 })}`);
    expect(text).toContain(`${i18n.t('request.all_history_row_added')}${i18n.t('request.all_history_row_no', { n: 5 })}`);
    expect(text).toContain(`${i18n.t('request.all_history_row_removed')}${i18n.t('request.all_history_prev_row_no', { n: 3 })}`);
    // '변경 전/후' 라벨과 구분하려고 "변경N행" 꼴(행 변경 표시)이 없는지 본다.
    expect(text).not.toMatch(new RegExp(`${i18n.t('request.all_history_row_changed')}\\d+`));
  });
});

describe('J-ayer — id 가 일부라도 겹치면 종전대로 id 로만 짝짓는다', () => {
  it('지우고 같은 내용으로 다시 추가한 행은 신규다(PP 로 짝짓지 않는다)', () => {
    const prev = PREV_SEEDS.slice(0, 3).map(layerRow);
    const cur = [prev[0], prev[1], layerRow({ id: 'c1', sp: '5.50', pp: 'RCP_C', layerid: '30' })];
    const utils = render(<Harness doc={makeDoc({ jayerRows: prev }, { jayerRows: cur })} tab={TAB.jayer} />);
    expect(flaggedPps(utils)).toEqual(['RCP_C']);
    const modal = openModal(histButtons(utils)[0]);
    expect(within(modal).getAllByText(noneMark()).length).toBeGreaterThan(0);
  });
});

describe('O-ayer — id 가 전부 바뀐 회차(표 재조회)', () => {
  it('중간에 끼어든 2행만 강조된다', () => {
    const utils = render(<Harness doc={makeDoc({ oayerRows: prevRows }, { oayerRows: curRows })} tab={TAB.oayer} />);
    expect(flaggedPps(utils)).toEqual(['RCP_N1', 'RCP_N2']);
  });
});

describe('뼈찜 — 이번 규칙 대상 아님(위치 폴백 유지)', () => {
  it('id 가 전부 바뀌고 맨 앞에 행이 끼어들면 종전처럼 위치로 짝지어 아래 행도 강조된다', () => {
    const prev = [bbRow('b1', 'BB_X'), bbRow('b2', 'BB_Y')];
    const cur = [bbRow('m0', 'BB_NEW'), bbRow('m1', 'BB_X'), bbRow('m2', 'BB_Y')];
    const utils = render(<Harness doc={makeDoc({ bbRows: prev }, { bbRows: cur })} tab={TAB.bb} />);
    expect(histButtons(utils)).toHaveLength(3);
  });
});
