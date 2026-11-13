/**
 * claude 수정 (2026-11-13): 전체 export(exportAll) 회귀 테스트.
 * - 시트 이름·순서(JOB 뒤 'agent E', 맨 끝 '결재 경로' 캡처 시트)
 * - 파일명 '전체' 접미사의 i18n(영어 화면에서는 'All')
 * - MAP 정보 (텍스트) 시트의 '숫자 확인 필수'·'숫자 확인 값' 행(상세 보기와 같은 표시 조건)
 * - 'agent E' 시트의 Validation System 판정·변경 이력
 * exportAll 이 만든 통합 문서를 실제 xlsx 로 다시 읽어 확인한다.
 */
import ExcelJS from 'exceljs';
import i18n from '../i18n';
import { exportAll } from './detailExport';
import { MAP_TYPE_DELETE_REQ, NUM_CHECK_APPLIES, VALIDATION_KEYWORD, VS_NONTARGET, VS_TARGET } from '../pages/RequestPage/constants';
import type { RequestDocument } from '../types';

const NO_SCREENSHOTS = { detail: null, map: null, etc: null, route: null };
const PLEL_PP = `PP01_${VALIDATION_KEYWORD}`;

const jayerRow = (pp: string) => ({
  id: 'j1', process_id: 'PR1', sp: 'SP01', sd: 'SD01', layerid: 'L01', pp,
  st: 'O', new_or_copy: '신규', product_name: 'P1', step: '1', item_id: 'I1',
});

const makeDoc = (detail: Record<string, unknown>, jayerPp = 'PP01'): RequestDocument => ({
  id: 1, title: 'export-all', requester_name: '이의뢰', requester_email: 'r@company.com',
  requester_department: 'dept', product_name: 'PROD-1', reference_materials: '',
  additional_notes: JSON.stringify({
    detail: { request_purpose: '신규', map_type: 'NEW', only_prodc: 'No', ...detail },
    jayerRows: [jayerRow(jayerPp)], oayerRows: [], bbRows: [], history: [],
  }),
  status: 'under_review', production_date: null, created_at: '', updated_at: '', submitted_at: '', approval_steps: [],
} as unknown as RequestDocument);

interface Exported { filename: string; sheetNames: string[]; cells: (sheet: string) => string[] }

/** exportAll 이 내려받으려던 xlsx 의 파일명·시트 이름·시트별 셀 문자열을 모은다. */
async function runExportAll(doc: RequestDocument): Promise<Exported> {
  let captured: Blob | null = null;
  let filename = '';
  URL.createObjectURL = (b: Blob | MediaSource) => { captured = b as Blob; return 'blob:test'; };
  URL.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) { filename = this.download; };
  await exportAll(doc, i18n.t.bind(i18n), NO_SCREENSHOTS);
  if (!captured) throw new Error('exportAll 이 xlsx 를 만들지 않았다');
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(captured as Blob);
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheetNames: string[] = [];
  const cellMap: Record<string, string[]> = {};
  wb.eachSheet((ws) => {
    sheetNames.push(ws.name);
    const cells: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? ''))));
    cellMap[ws.name] = cells;
  });
  return { filename, sheetNames, cells: (sheet) => cellMap[sheet] ?? [] };
}

const mapTextSheet = () => `${i18n.t('request.section_map')}${i18n.t('request.export_text_suffix')}`;
const agentESheet = () => i18n.t('request.export_sheet_agent_e');

beforeEach(async () => { await i18n.changeLanguage('ko'); });

describe('전체 export — 시트 구성', () => {
  it('JOB 바로 뒤에 agent E, 맨 끝에 결재 경로 시트가 온다', async () => {
    const { sheetNames } = await runExportAll(makeDoc({}));
    const text = i18n.t('request.export_text_suffix');
    expect(sheetNames).toEqual([
      i18n.t('request.section_detail'), `${i18n.t('request.section_detail')}${text}`,
      i18n.t('request.section_map'), `${i18n.t('request.section_map')}${text}`,
      'JOB', agentESheet(), 'OVL', i18n.t('request.ovl_tab_info'),
      i18n.t('request.extra_li'), 'BB',
      i18n.t('request.section_etc'), `${i18n.t('request.section_etc')}${text}`,
      i18n.t('approval.tab_route'),
    ]);
  });

  it('결재 경로 캡처가 없으면 캡처 실패 문구를 넣는다', async () => {
    const exported = await runExportAll(makeDoc({}));
    expect(exported.cells(i18n.t('approval.tab_route'))).toEqual([i18n.t('request.export_capture_failed')]);
  });
});

describe('전체 export — 파일명', () => {
  it("한국어 화면은 '<제목>_전체_<시각>.xlsx'", async () => {
    const { filename } = await runExportAll(makeDoc({}));
    expect(filename).toMatch(/^export-all_전체_\d{8}_\d{6}\.xlsx$/);
  });

  it("영어 화면은 '전체' 대신 'All'", async () => {
    await i18n.changeLanguage('en');
    const { filename } = await runExportAll(makeDoc({}));
    expect(filename).toMatch(/^export-all_All_\d{8}_\d{6}\.xlsx$/);
  });
});

describe('MAP 정보 (텍스트) — 숫자 확인 필수', () => {
  it("'해당 있음'이면 해당 여부와 숫자 확인 값이 X표시 다음에 나온다", async () => {
    const exported = await runExportAll(makeDoc({ mshot_change: '없음', num_check: NUM_CHECK_APPLIES, num_check_value: '13 이상' }));
    const cells = exported.cells(mapTextSheet());
    const titleIdx = cells.indexOf(i18n.t('request.num_check_title'));
    expect(titleIdx).toBeGreaterThan(cells.indexOf(i18n.t('request.mshot_change_status')));
    expect(cells[titleIdx + 1]).toBe(i18n.t('request.num_check_applies'));
    const valueIdx = cells.indexOf(i18n.t('request.num_check_value'));
    expect(cells[valueIdx + 1]).toBe(i18n.t('request.num_check_over', { value: '13' }));
  });

  it("'해당 없음'이고 사진도 없으면 행이 없다", async () => {
    const exported = await runExportAll(makeDoc({ num_check: '해당 없음', num_check_images: [] }));
    expect(exported.cells(mapTextSheet())).not.toContain(i18n.t('request.num_check_title'));
  });

  it('MAP 삭제 문서에는 행이 없다', async () => {
    const exported = await runExportAll(makeDoc({ map_type: MAP_TYPE_DELETE_REQ, num_check: NUM_CHECK_APPLIES }));
    expect(exported.cells(mapTextSheet())).not.toContain(i18n.t('request.num_check_title'));
  });
});

describe('agent E — Validation System', () => {
  const vsValue = async (detail: Record<string, unknown>, pp: string): Promise<string> => {
    const cells = (await runExportAll(makeDoc(detail, pp))).cells(agentESheet());
    return cells[cells.indexOf(i18n.t('request.validation_system')) + 1];
  };

  it('판정 키워드가 없으면 해당없음', async () => {
    expect(await vsValue({ validation_system: VS_TARGET }, 'PP01')).toBe(i18n.t('request.validation_system_na'));
  });

  it('판정 키워드가 있고 비대상이면 비대상', async () => {
    expect(await vsValue({ validation_system: VS_NONTARGET }, PLEL_PP)).toBe(i18n.t('request.validation_system_nontarget'));
  });

  it('상신 값과 다르면 변경 이력(상신 시 → 현재, 변경자·일시)을 함께 담는다', async () => {
    const value = await vsValue({
      validation_system: VS_NONTARGET, validation_system_submitted: VS_TARGET,
      validation_system_changed_by: '김검토', validation_system_changed_at: '2026-11-12T09:30:00',
    }, PLEL_PP);
    const target = i18n.t('request.validation_system_target');
    const nontarget = i18n.t('request.validation_system_nontarget');
    expect(value.split('\n')).toEqual([
      nontarget,
      i18n.t('request.validation_system_changed', { from: target, to: nontarget }),
      i18n.t('request.validation_system_changed_by', { name: '김검토', at: '2026-11-12 09:30' }),
    ]);
  });
});
