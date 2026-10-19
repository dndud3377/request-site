/**
 * 참조 요청서 '없음' 모드 — 변경전/변경후 표에서 Layer 열을 숨긴다.
 *
 * claude 수정 (2026-10-19): '없음' 모드는 Layer 를 입력하지도 받지도 않아 열이 보이면 헷갈린다.
 * 작성 화면(BeforeAfterPanel)·상세보기(PagedDetailView)·상세 내보내기(exportDetailInfoImage) 세 곳 모두
 * '없음'이면 Layer 열이 없고, '있음'이면 기존처럼 변경전/변경후 각각 Layer 열이 있다.
 */
import React, { useState } from 'react';
import { render } from '@testing-library/react';
import ExcelJS from 'exceljs';
import BeforeAfterPanel from './components/BeforeAfterPanel';
import PagedDetailView from '../../components/PagedDetailView';
import { exportDetailInfoImage } from '../../utils/detailExport';
import { INITIAL_DETAIL } from './constants';
import i18n from '../../i18n';
import { DetailFormState, MergePair, MergeRefMode, RequestDocument } from '../../types';

const LAYER = i18n.t('request.col_layer');
const DETAIL_PAGE_IDX = 0;

const side = (pp: string) => ({ process_id: 'PROC_X1', sp: 'SP01', sd: 'SD01', pp, layerid: '' });

const PAIRS: MergePair[] = [
  { id: 'p1', table: 'J', beforeId: null, before: side('TEST1_OLD'), afterId: null, after: side('TEST1_IN'), kind: 'changed' },
  { id: 'p2', table: 'J', beforeId: null, before: null, afterId: null, after: side('TEST1_NEW'), kind: 'added' },
];

const detailOf = (mode: MergeRefMode): DetailFormState => ({
  ...INITIAL_DETAIL,
  other_purpose: ['Layer 추가/삭제'],
  merge_ref_mode: mode,
  merge_applied: true,
  merge_pairs: PAIRS,
});

const noop = () => undefined;

const renderPanel = (mode: MergeRefMode) => render(
  <BeforeAfterPanel
    detail={detailOf(mode)}
    jayerRows={[]}
    oayerRows={[]}
    sameCount={0}
    manualOnly={mode === 'none'}
    manualCheck={null}
    selBefore={null}
    selAfter={null}
    onSelect={noop}
    onApply={noop}
    onUnpair={noop}
    onCellChange={noop}
    onCellBlur={noop}
    onPasteRaw={noop}
    onTableChange={noop}
    onAddRow={noop}
    onResetRow={noop}
  />
);

const makeDoc = (mode: MergeRefMode): RequestDocument => ({
  id: 1,
  title: 'none-layer-doc',
  requester_name: '이의뢰',
  requester_email: 'req@company.com',
  requester_department: 'dept',
  product_name: 'PROD-1',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: detailOf(mode), history: [] }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-10-19T00:00:00Z',
  updated_at: '2026-10-19T00:00:00Z',
  submitted_at: '2026-10-19T00:00:00Z',
  approval_steps: [],
} as unknown as RequestDocument);

const DetailHarness: React.FC<{ doc: RequestDocument }> = ({ doc }) => {
  const [pageIdx, setPageIdx] = useState(DETAIL_PAGE_IDX);
  return <PagedDetailView doc={doc} role="PL" pageIdx={pageIdx} setPageIdx={setPageIdx} />;
};

/** 확정 표(.ba-result-table) 머리글 중 Layer 열 수 */
const layerHeaderCount = (root: ParentNode): number =>
  Array.from(root.querySelectorAll('.ba-result-table th')).filter((th) => th.textContent === LAYER).length;

/** 변경전/변경후 그룹 머리글의 colSpan */
const groupColSpans = (root: ParentNode): number[] =>
  Array.from(root.querySelectorAll<HTMLTableCellElement>('.ba-result-table th.ba-group-before[colspan], .ba-result-table th.ba-group-after[colspan]'))
    .map((th) => th.colSpan);

/** 미등록 칸의 colSpan */
const unregColSpans = (root: ParentNode): number[] =>
  Array.from(root.querySelectorAll<HTMLTableCellElement>('.ba-result-table td.ba-cell-unreg')).map((td) => td.colSpan);

/** 상세 내보내기가 만든 xlsx 의 모든 셀 문자열 */
async function exportedCells(doc: RequestDocument): Promise<string[]> {
  let captured: Blob | null = null;
  URL.createObjectURL = (b: Blob | MediaSource) => { captured = b as Blob; return 'blob:test'; };
  URL.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = () => undefined;
  await exportDetailInfoImage(doc, i18n.t.bind(i18n), null);
  if (!captured) throw new Error('export 가 xlsx 를 만들지 않았다');
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(captured as Blob);
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const cells: string[] = [];
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? '')))));
  return cells;
}

const layerExportHeaders = () => [
  `${LAYER}(${i18n.t('request.ba_before_col')})`,
  `${LAYER}(${i18n.t('request.ba_after_col')})`,
];

describe('작성 화면(BeforeAfterPanel) — 확정 표 Layer 열', () => {
  it("'없음'이면 Layer 머리글이 없고 한쪽 4칸으로 맞춰진다", () => {
    const { container } = renderPanel('none');
    expect(layerHeaderCount(container)).toBe(0);
    expect(groupColSpans(container)).toEqual([4, 4]);
    expect(unregColSpans(container)).toEqual([4]);
    // 정상 행(p1) 셀 수: 구분 1 + 변경전 4 + 변경후 4 + 판정 1 + 버튼 1
    const firstRow = container.querySelector('.ba-result-table tbody tr') as HTMLTableRowElement;
    expect(firstRow.cells).toHaveLength(11);
  });

  it("'있음'이면 기존처럼 변경전/변경후 각각 Layer 열이 있다", () => {
    const { container } = renderPanel('ref');
    expect(layerHeaderCount(container)).toBe(2);
    expect(groupColSpans(container)).toEqual([5, 5]);
    expect(unregColSpans(container)).toEqual([5]);
    const firstRow = container.querySelector('.ba-result-table tbody tr') as HTMLTableRowElement;
    expect(firstRow.cells).toHaveLength(13);
  });

  it("'없음'에서 행이 0건이면 안내 칸이 11열을 덮는다", () => {
    const { container } = render(
      <BeforeAfterPanel
        detail={{ ...detailOf('none'), merge_pairs: [] }}
        jayerRows={[]}
        oayerRows={[]}
        sameCount={0}
        manualOnly
        manualCheck={null}
        selBefore={null}
        selAfter={null}
        onSelect={noop}
        onApply={noop}
        onUnpair={noop}
        onCellChange={noop}
        onCellBlur={noop}
        onPasteRaw={noop}
        onTableChange={noop}
        onAddRow={noop}
        onResetRow={noop}
      />
    );
    const hint = container.querySelector('.ba-result-table td.ba-hint') as HTMLTableCellElement;
    expect(hint.colSpan).toBe(11);
  });
});

describe('상세보기(PagedDetailView) — 변경전/변경후 표 Layer 열', () => {
  it("'없음' 문서는 Layer 열이 없다", () => {
    const { container } = render(<DetailHarness doc={makeDoc('none')} />);
    expect(container.querySelector('.ba-result-table')).not.toBeNull();
    expect(layerHeaderCount(container)).toBe(0);
    expect(groupColSpans(container)).toEqual([4, 4]);
    expect(unregColSpans(container)).toEqual([4]);
  });

  it("'있음' 문서는 기존처럼 Layer 열이 있다", () => {
    const { container } = render(<DetailHarness doc={makeDoc('ref')} />);
    expect(layerHeaderCount(container)).toBe(2);
    expect(groupColSpans(container)).toEqual([5, 5]);
    expect(unregColSpans(container)).toEqual([5]);
  });
});

describe('상세 내보내기 — 변경전/변경후 표 Layer 열', () => {
  it("'없음' 문서는 Layer 열을 내보내지 않는다", async () => {
    const cells = await exportedCells(makeDoc('none'));
    expect(cells).toContain(`${i18n.t('request.col_pp')}(${i18n.t('request.ba_before_col')})`);
    layerExportHeaders().forEach((h) => expect(cells).not.toContain(h));
  });

  it("'있음' 문서는 기존처럼 Layer 열을 내보낸다", async () => {
    const cells = await exportedCells(makeDoc('ref'));
    layerExportHeaders().forEach((h) => expect(cells).toContain(h));
  });
});
