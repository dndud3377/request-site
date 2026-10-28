/**
 * claude 수정 (2026-10-28): 상세 모달 XXXXXX 페이지 — 상신 시점 스냅샷(extra_layer_snapshot)을 J-layer 앞 6개 컬럼으로
 * 보여주고, 재상신 이력(history[].extraRows)으로 회차 비교(변경 강조·이력 확인·모든 이력 확인)를 한다.
 * 짝짓기는 J/O-layer 와 같은 내용 규칙(공정ID+PP → 공정ID+Layer)이다. extraRows 가 없는(기능 배포 전) 회차는 비교에서 뺀다.
 */
import React, { useState } from 'react';
import { render, fireEvent, within, RenderResult } from '@testing-library/react';
import PagedDetailView from './PagedDetailView';
import i18n from '../i18n';
import { RequestDocument, ExtraLayerSnapshotRow } from '../types';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const TAB = { oayer: 3, extra: 4 } as const;
const PREV_TS = '2026-10-20T00:00:00Z';
const base = { request_purpose: '신규', line: 'line1', process_selection: 'PROC1', partid_selection: 'FP1', process_id: 'FPID1', map_type: 'NEW' };

const snapRow = (stepseq: string, recipeid: string, layerid: string, descript = `D_${stepseq}`): ExtraLayerSnapshotRow => ({
  line: 'line1', process: 'FPID1', processid: 'FPID1', stepseq, descript, recipeid,
  areaname: 'AREA', layerid, updated: '202610011030',
});

const PREV: ExtraLayerSnapshotRow[] = [snapRow('10', 'RCP_A', '1'), snapRow('20', 'RCP_B', '2'), snapRow('30', 'RCP_C', '3')];
// 현재 회차 — 맨 앞에 새 행이 끼어들고, RCP_B 행의 설명이 바뀌었다.
const CUR: ExtraLayerSnapshotRow[] = [
  snapRow('05', 'RCP_NEW', '9'), snapRow('10', 'RCP_A', '1'), snapRow('20', 'RCP_B', '2', 'D_CHANGED'), snapRow('30', 'RCP_C', '3'),
];

const makeDoc = (cur: ExtraLayerSnapshotRow[], history: Record<string, unknown>[] = []): RequestDocument => ({
  id: 1,
  title: 'extra-layer-doc',
  requester_name: '이의뢰',
  requester_email: 'req@company.com',
  requester_department: 'dept',
  product_name: 'FP1',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: base, jayerRows: [], oayerRows: [], bbRows: [], history }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-28T00:00:00Z',
  submitted_at: '2026-10-28T00:00:00Z',
  approval_steps: [],
  extra_layer_snapshot: cur,
} as RequestDocument);

const prevRound = (extraRows?: ExtraLayerSnapshotRow[]) => ({
  detail: base, jayerRows: [], oayerRows: [], bbRows: [], timestamp: PREV_TS, ...(extraRows ? { extraRows } : {}),
});

const Harness: React.FC<{ doc: RequestDocument; tab: number; historyMode?: boolean }> = ({ doc, tab, historyMode }) => {
  const [pageIdx, setPageIdx] = useState(tab);
  return <PagedDetailView doc={doc} role="PL" pageIdx={pageIdx} setPageIdx={setPageIdx} historyMode={historyMode} />;
};

const histButtons = (utils: RenderResult): HTMLElement[] =>
  utils.queryAllByRole('button', { name: i18n.t('request.history_check_btn') });

/** '이력 확인' 버튼이 달린 행의 PP 값 — PP 는 버튼 칸 포함 7번째 칸이다. */
const flaggedPps = (utils: RenderResult): string[] =>
  histButtons(utils).map((b) => (b.closest('tr') as HTMLElement).querySelectorAll('td')[6].textContent ?? '');

const dataTable = (utils: RenderResult): HTMLTableElement => utils.container.querySelector('table.table-compact') as HTMLTableElement;

describe('XXXXXX 페이지 — 표시', () => {
  it('O-ayer 정보 다음 페이지로 XXXXXX 가 생기고, 스냅샷을 J-layer 앞 6개 컬럼으로 보여준다', () => {
    const utils = render(<Harness doc={makeDoc(PREV)} tab={TAB.extra} />);
    const table = dataTable(utils);
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headers).toEqual([
      i18n.t('request.col_updated_date'), i18n.t('request.process_id'), i18n.t('request.col_sp'),
      i18n.t('request.col_sd'), i18n.t('request.col_layer'), i18n.t('request.col_pp'),
    ]);
    const firstRow = Array.from(table.querySelectorAll('tbody tr')[0].querySelectorAll('td')).map((td) => td.textContent);
    expect(firstRow).toEqual(['20261001 10:30', 'FPID1', '10', 'D_10', '1', 'RCP_A']);
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(utils.getByText(i18n.t('request.total_count_items', { count: 3 }))).toBeTruthy();
    // 사용자 입력 컬럼·필터·색상 적용은 없다.
    expect(utils.queryByText(i18n.t('request.col_st_j'))).toBeNull();
    expect(utils.queryByText(i18n.t('request.layer_filter_manage_btn'))).toBeNull();
  });

  it('O-ayer 정보 페이지 인덱스는 그대로다(XXXXXX 는 그 뒤에 붙는다)', () => {
    const utils = render(<Harness doc={makeDoc(PREV)} tab={TAB.oayer} />);
    expect(utils.getAllByText(i18n.t('request.ovl_li')).length).toBeGreaterThan(0);
  });

  it('스냅샷이 없으면 데이터 없음으로 보인다', () => {
    const utils = render(<Harness doc={makeDoc([])} tab={TAB.extra} />);
    expect(utils.getByText(i18n.t('common.no_data'))).toBeTruthy();
  });
});

describe('XXXXXX 페이지 — 회차 비교(결재 진행 중)', () => {
  it('직전 회차와 내용으로 짝지어, 끼어든 행과 값이 바뀐 행만 강조한다', () => {
    const utils = render(<Harness doc={makeDoc(CUR, [prevRound(PREV)])} tab={TAB.extra} />);
    expect(flaggedPps(utils)).toEqual(['RCP_NEW', 'RCP_B']);
  });

  it('이력 확인을 누르면 변경 전/후가 보인다', () => {
    const utils = render(<Harness doc={makeDoc(CUR, [prevRound(PREV)])} tab={TAB.extra} />);
    const btn = histButtons(utils).find((b) => (b.closest('tr') as HTMLElement).textContent?.includes('RCP_B')) as HTMLElement;
    fireEvent.click(btn);
    const modal = document.querySelector('.modal') as HTMLElement;
    expect(within(modal).getByText(i18n.t('request.extra_row_history'))).toBeTruthy();
    expect(within(modal).getByText('D_20')).toBeTruthy();
    expect(within(modal).getByText('D_CHANGED')).toBeTruthy();
  });

  it('직전 회차에 extraRows 가 없으면(기능 배포 전) 비교하지 않는다', () => {
    const utils = render(<Harness doc={makeDoc(CUR, [prevRound()])} tab={TAB.extra} />);
    expect(histButtons(utils)).toHaveLength(0);
    // 비교할 회차가 없으니 버튼 칸 자체가 없다(헤더 6칸).
    expect(dataTable(utils).querySelectorAll('thead th')).toHaveLength(6);
  });
});

describe('XXXXXX 페이지 — 이력 조회 모드', () => {
  it('extraRows 가 있는 회차끼리만 비교한다 — 배포 전 회차는 전부 신규로 잡히지 않는다', () => {
    const history = [prevRound(), prevRound(PREV)];
    const utils = render(<Harness doc={makeDoc(CUR, history)} tab={TAB.extra} historyMode />);
    expect(flaggedPps(utils)).toEqual(['RCP_NEW', 'RCP_B']);
  });

  it('모든 이력 확인 모달에 XXXXXX 변경(신규·변경)이 모인다', () => {
    const utils = render(<Harness doc={makeDoc(CUR, [prevRound(PREV)])} tab={TAB.extra} historyMode />);
    fireEvent.click(utils.getByRole('button', { name: `🕘 ${i18n.t('request.all_history_btn')}` }));
    const modal = document.querySelector('.modal') as HTMLElement;
    expect(within(modal).getByText(i18n.t('request.all_history_title', { tab: i18n.t('request.extra_li') }))).toBeTruthy();
    expect(within(modal).getAllByText(i18n.t('request.all_history_row_added'))).toHaveLength(1);
    expect(within(modal).getAllByText(i18n.t('request.all_history_row_changed'))).toHaveLength(1);
    expect(within(modal).queryByText(i18n.t('request.all_history_row_removed'))).toBeNull();
  });
});
