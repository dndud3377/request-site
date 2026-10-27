/**
 * 결재 상세 MAP 정보 탭·export — CLONE/EXISTING 잠금 항목(지도 편차·예외 구역·X표시·C가문 세부·3번·Map Option)은
 * 실제로 기본값일 때만 "없음"으로 보이고, 기본값이 아닌 값(오류로 저장된 값)이 있으면 저장값과 함께
 * 잠금 항목 경고(approval.locked_value_warning)가 붙는지 검증한다.
 */
import React, { useState } from 'react';
import ExcelJS from 'exceljs';
import { render, screen } from '@testing-library/react';
import PagedDetailView from './PagedDetailView';
import i18n from '../i18n';
import { exportMapInfoImage } from '../utils/detailExport';
import { RequestDocument } from '../types';

const MAP_TAB_IDX = 1;
const WARNING = i18n.t('approval.locked_value_warning');
const NONE = i18n.t('request.value_none');
/** 잠금 항목 6개의 라벨 키 — 정상 문서에서는 모두 회색 "없음", 잔존값 문서에서는 모두 경고가 붙어야 한다 */
const LOCKED_LABEL_KEYS = [
  'request.map', 'request.ea_change', 'request.mshot_change_status',
  'approval.prodc_detail', 'request.map_opt_inter', 'request.map_option_title',
];
const LOCKED_ITEM_COUNT = LOCKED_LABEL_KEYS.length;
/** 회색 "없음"(PlaceholderChip 등) span 의 인라인 글자 크기 — 회색 "없음"은 모두 { fontSize: 0.85rem, color: text-muted } span 으로 그린다.
 *  jsdom 은 var() 색상 값을 버리므로 글자 크기로 그 span 인지 판별한다(저장값 텍스트는 span 없이 그려진다). */
const MUTED_NONE_STYLE = 'font-size: 0.85rem';

/** CLONE 이 정상 작성됐을 때 저장되는 값(잠긴 칸은 전부 기본값) — C가문 Yes 라 예외 구역 기본값은 500 */
const cloneDefaults = {
  request_purpose: '차용', map_type: 'CLONE', source_line: '라인2', source_partid: 'SRC00001',
  map_change: '변경 없음', map_value_x: '', map_value_y: '', map_reason: '',
  map_change_top: '변경 없음', map_value_x_top: '', map_value_y_top: '',
  map_change_bottom: '변경 없음', map_value_x_bottom: '', map_value_y_bottom: '',
  ea_change: '변경 없음', ea_value: '500',
  only_prodc: 'Yes', py_apply: 'Y', prodc_scope: '',
  prodc_top_line: '', prodc_top_process: '', prodc_top_product: '',
  prodc_middle_use: '', prodc_bottom_line: '', prodc_bottom_process: '', prodc_bottom_product: '',
  mshot_change: '없음', mshot_image_copy: '', mshot_image_copy_top: '', mshot_image_copy_bottom: '',
  inter: 'NO', in_apply: '', tsv: '미적용', ecc: '미적용',
  final_yn: 'YES', final_entries: ['GDS_V2.0'],
};

/** 잠긴 칸 6개 모두에 기본값이 아닌 값이 남은 CLONE(오류·예전 임시저장·API 직접 호출) */
const cloneResidue = {
  ...cloneDefaults,
  map_change_top: '변경 있음', map_value_x_top: '12', map_value_y_top: '3',
  ea_change: '변경 있음', ea_value: '777',
  prodc_scope: 'top', prodc_top_line: '라인3', prodc_top_process: 'RC9', prodc_top_product: 'PX9',
  mshot_change: '삭제',
  inter: 'YES', in_apply: 'O',
  // Map Option 은 CLONE/EXISTING 에서 잠기는 옵션(ECC=9번)으로 잔존값을 만든다 — TSV(4번)는 CLONE/EXISTING 에서도 고를 수 있다.
  ecc: '적용',
};

const TSV_LABEL = i18n.t('request.map_opt_tsv');
const ECC_LABEL = i18n.t('request.map_opt_ecc');

const makeDoc = (detail: Record<string, unknown>): RequestDocument => ({
  id: 1,
  title: 'locked-default-doc',
  requester_name: '이의뢰',
  requester_email: 'req@company.com',
  requester_department: 'dept',
  product_name: 'PROD-1',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail, history: [] }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-10-27T00:00:00Z',
  updated_at: '2026-10-27T00:00:00Z',
  submitted_at: '2026-10-27T00:00:00Z',
  approval_steps: [],
} as RequestDocument);

const Harness: React.FC<{ doc: RequestDocument }> = ({ doc }) => {
  const [pageIdx, setPageIdx] = useState(MAP_TAB_IDX);
  return <PagedDetailView doc={doc} role="PL" pageIdx={pageIdx} setPageIdx={setPageIdx} />;
};

/** 라벨 칸(fieldLabel — 라벨 글자로 시작하고 뒤에 경고가 붙을 수 있다)의 부모 = 그 항목의 값까지 담은 칸 */
const itemBox = (labelKey: string): HTMLElement => {
  const label = i18n.t(labelKey as never);
  const matches = screen.getAllByText((_, el) => {
    const first = el?.childNodes[0];
    return !!first && first.nodeType === Node.TEXT_NODE && first.textContent === label;
  });
  return matches[0].parentElement as HTMLElement;
};

/** export 가 내려받으려던 xlsx 의 모든 셀 문자열을 모은다. */
async function exportedCells(doc: RequestDocument): Promise<string[]> {
  let captured: Blob | null = null;
  URL.createObjectURL = (b: Blob | MediaSource) => { captured = b as Blob; return 'blob:test'; };
  URL.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = () => undefined;
  await exportMapInfoImage(doc, i18n.t.bind(i18n), null);
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

describe('상세 MAP 정보 탭 — CLONE/EXISTING 잠금 항목 표시', () => {
  it('정상 작성(잠긴 칸 전부 기본값)이면 잠금 항목은 "없음"이고 경고가 없다', () => {
    render(<Harness doc={makeDoc(cloneDefaults)} />);
    expect(screen.queryAllByText(WARNING)).toHaveLength(0);
    expect(itemBox('request.map').textContent).toContain(NONE);
    expect(itemBox('request.ea_change').textContent).toContain(NONE);
    expect(itemBox('approval.prodc_detail').textContent).toContain(NONE);
    expect(itemBox('request.map_opt_inter').textContent).toContain(NONE);
    expect(itemBox('request.map_option_title').textContent).toContain(NONE);
  });

  it('정상 작성이면 잠금 항목 6개 모두 같은 회색 "없음"(같은 muted span)으로 통일돼 보인다', () => {
    render(<Harness doc={makeDoc(cloneDefaults)} />);
    LOCKED_LABEL_KEYS.forEach((key) => {
      const none = Array.from(itemBox(key).querySelectorAll('span')).find((s) => s.textContent === NONE);
      expect(none?.getAttribute('style')).toContain(MUTED_NONE_STYLE);
    });
  });

  it('X표시 값이 비어 있어도(기본값) 카드가 그려지고 회색 "없음"이다', () => {
    render(<Harness doc={makeDoc({ ...cloneDefaults, mshot_change: '' })} />);
    const none = Array.from(itemBox('request.mshot_change_status').querySelectorAll('span')).find((s) => s.textContent === NONE);
    expect(none?.getAttribute('style')).toContain(MUTED_NONE_STYLE);
    expect(screen.queryAllByText(WARNING)).toHaveLength(0);
  });

  it('잠긴 칸에 기본값이 아닌 값이 있으면 저장값을 보여주고 6개 항목 모두에 경고가 붙는다', () => {
    render(<Harness doc={makeDoc(cloneResidue)} />);
    expect(screen.getAllByText(WARNING)).toHaveLength(LOCKED_ITEM_COUNT);
    expect(itemBox('request.map').textContent).toContain('12um');
    expect(itemBox('request.ea_change').textContent).toContain('777');
    expect(itemBox('request.mshot_change_status').textContent).toContain('삭제');
    expect(itemBox('approval.prodc_detail').textContent).toContain('라인3 / RC9 / PX9');
    expect(itemBox('request.map_opt_inter').textContent).toContain(i18n.t('approval.inter_applied'));
    expect(itemBox('request.map_option_title').textContent).toContain(ECC_LABEL);
  });

  it('TSV(4번)만 적용이면 CLONE 에서도 정상 입력이라 경고 없이 [4번]만 보인다', () => {
    render(<Harness doc={makeDoc({ ...cloneDefaults, tsv: '적용' })} />);
    expect(screen.queryAllByText(WARNING)).toHaveLength(0);
    expect(itemBox('request.map_option_title').textContent).toContain(TSV_LABEL);
  });

  it('TSV 와 잠기는 옵션(9번)이 함께 적용이면 Map Option 카드에 경고가 붙는다', () => {
    render(<Harness doc={makeDoc({ ...cloneDefaults, tsv: '적용', ecc: '적용' })} />);
    expect(screen.getAllByText(WARNING)).toHaveLength(1);
    const box = itemBox('request.map_option_title');
    expect(box.textContent).toContain(WARNING);
    expect(box.textContent).toContain(TSV_LABEL);
    expect(box.textContent).toContain(ECC_LABEL);
  });

  it('EXISTING 에서 예외 구역만 기본값이 아니면 그 항목에만 경고가 붙는다', () => {
    render(<Harness doc={makeDoc({ ...cloneDefaults, map_type: 'EXISTING', ea_change: '변경 있음', ea_value: '777' })} />);
    expect(screen.getAllByText(WARNING)).toHaveLength(1);
    expect(itemBox('request.ea_change').textContent).toContain(WARNING);
    expect(itemBox('request.map').textContent).toContain(NONE);
  });

  it('예외 구역 기본값은 숫자로 비교한다 — 변경 없음 + 500.0 은 기본값("없음")이다', () => {
    render(<Harness doc={makeDoc({ ...cloneDefaults, ea_value: '500.0' })} />);
    expect(screen.queryAllByText(WARNING)).toHaveLength(0);
    expect(itemBox('request.ea_change').textContent).toContain(NONE);
  });

  it('NEW 문서는 같은 값이 있어도 경고가 붙지 않는다(잠금 항목이 아니다)', () => {
    render(<Harness doc={makeDoc({ ...cloneResidue, request_purpose: '신규', map_type: 'NEW', source_line: '', source_partid: '' })} />);
    expect(screen.queryAllByText(WARNING)).toHaveLength(0);
    expect(itemBox('request.ea_change').textContent).toContain('777');
  });
});

describe('MAP 정보 export — CLONE/EXISTING 잠금 항목 표시', () => {
  it('정상 작성이면 잠금 항목은 "없음"이고 경고 문구가 없다', async () => {
    const cells = await exportedCells(makeDoc(cloneDefaults));
    expect(cells.some((c) => c.includes(WARNING))).toBe(false);
  });

  it('잠긴 칸에 값이 있으면 6개 항목 모두 경고 문구 + 저장값으로 내보낸다', async () => {
    const cells = await exportedCells(makeDoc(cloneResidue));
    const warned = cells.filter((c) => c.startsWith(`${WARNING} — `));
    expect(warned).toHaveLength(LOCKED_ITEM_COUNT);
    expect(warned.some((c) => c.includes('777'))).toBe(true);
    expect(warned.some((c) => c.endsWith('삭제'))).toBe(true);
  });

  it('TSV(4번)만 적용이면 Map Option 행은 경고 없이 "4번", 9번이 함께면 경고 문구가 붙는다', async () => {
    const tsvOnly = await exportedCells(makeDoc({ ...cloneDefaults, tsv: '적용' }));
    expect(tsvOnly).toContain(TSV_LABEL);
    expect(tsvOnly.some((c) => c.includes(WARNING))).toBe(false);

    const withEcc = await exportedCells(makeDoc({ ...cloneDefaults, tsv: '적용', ecc: '적용' }));
    expect(withEcc).toContain(`${WARNING} — ${TSV_LABEL}, ${ECC_LABEL}`);
  });
});
