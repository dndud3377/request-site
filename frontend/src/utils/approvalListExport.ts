import ExcelJS from 'exceljs';
import type { TFunction } from 'i18next';
import { RequestDocument, PersonalMarkCategory } from '../types';
import { getDocDetailFields, getDocTableRows, getDocSubmittedDate, hasActiveStageStep } from './approvalTable';
import { formatDateTime } from './date';
import { downloadWorkbook, getNowString } from './detailExport';
import { STATE_I18N_KEY } from '../components/StageGrid';
import { STATUS_I18N_KEY } from '../components/StatusBadge';

/**
 * 결재 현황 목록 엑셀 다운로드(docs/APPROVAL.md '결재 현황 목록 다운로드').
 * 목록의 라인 ~ 현재 단계 컬럼 + 내 범주를 '전체' 시트와 선택한 라인별 시트로 나눠 담는다.
 */

/** 다운로드 창의 팀 필터 — 상단 단계별 탭(agent_R 등)과 같은 판정(hasActiveStageStep)을 쓴다. */
export const EXPORT_TEAMS = ['R', 'P', 'J', 'O', 'E'] as const;
export type ExportTeam = typeof EXPORT_TEAMS[number];

/** 임시저장은 결재에 올라가지 않은 문서라 다운로드 대상에서 항상 뺀다. */
const EXCLUDED_STATUS = 'draft';

const HEADER_FILL = 'FFE5E7EB';
const COLUMN_WIDTHS = [10, 18, 14, 36, 18, 22, 40, 16];
// 범주 색 위 글자색 — 배경 밝기가 이 값 이하면 흰 글자로 바꾼다(0~255, 사람 눈 가중치 적용).
const DARK_BG_LUMA_THRESHOLD = 140;
const FONT_DARK = 'FF000000';
const FONT_LIGHT = 'FFFFFFFF';

/**
 * 다운로드 대상 문서를 고른다.
 * - 임시저장 제외
 * - 라인/팀을 '전체 선택'했으면 그 조건은 걸지 않는다 — 라인 값이 비어 있거나 R·P·J·O·E 어느
 *   단계에도 있지 않은 문서(1구역 PL/SA 진행 중·반려·중단 등)도 기본 다운로드에 빠지지 않게 하려는 것.
 * - 일부만 골랐으면 선택한 라인에 속하고, 선택한 팀 중 하나가 현재 진행 중인 문서만 남긴다.
 */
export const filterDocsForExport = (
  docs: RequestDocument[],
  lines: string[],
  allLines: readonly string[],
  teams: ExportTeam[],
): RequestDocument[] => {
  const lineSet = new Set(lines);
  const allLinesSelected = allLines.every((l) => lineSet.has(l));
  const allTeamsSelected = EXPORT_TEAMS.every((tm) => teams.includes(tm));
  return docs.filter((d) => {
    if (d.status === EXCLUDED_STATUS) return false;
    if (!allLinesSelected && !lineSet.has(getDocDetailFields(d).line)) return false;
    if (!allTeamsSelected && !teams.some((tm) => hasActiveStageStep(d, tm))) return false;
    return true;
  });
};

/** 목록의 '현재 단계' 칸을 셀 하나에 넣을 글자로 푼다(그리드는 칸마다 한 줄, '해당없음' 칸은 생략). */
const stageToText = (doc: RequestDocument, t: TFunction): string => {
  const row = getDocTableRows(doc, t)[0];
  const lines: string[] = [];
  if (row.cells) {
    row.cells
      .filter((c) => c.state !== 'na')
      .forEach((c) => {
        const name = c.name ? `(${c.name})` : '';
        const chip = c.pauseRequested ? ` ⏸ ${t('approval.pause_requested_chip')}` : '';
        lines.push(`${c.label}${name} ${t(STATE_I18N_KEY[c.state] as never)}${chip}`);
      });
  } else {
    const statusKey = STATUS_I18N_KEY[row.pathStatus];
    const status = statusKey ? t(statusKey as never) : row.pathStatus;
    const chip = row.pauseRequested ? ` ⏸ ${t('approval.pause_requested_chip')}` : '';
    lines.push(`${status} ${row.stageText}${chip}`.trim());
  }
  if (doc.withdraw_request) lines.push(t('approval.withdraw_requested_chip'));
  return lines.join('\n');
};

const fontColorFor = (hex: string): string => {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b <= DARK_BG_LUMA_THRESHOLD ? FONT_LIGHT : FONT_DARK;
};

const addListSheet = (
  wb: ExcelJS.Workbook,
  sheetName: string,
  docs: RequestDocument[],
  categories: PersonalMarkCategory[],
  t: TFunction,
): void => {
  const ws = wb.addWorksheet(sheetName);
  const header = ws.addRow([
    t('approval.col_line'),
    t('approval.col_purpose'),
    t('approval.col_map_purpose'),
    t('approval.col_product_combo'),
    t('approval.col_submitted'),
    t('approval.col_requester'),
    t('approval.col_current_stage'),
    t('approval.col_category'),
  ]);
  header.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  COLUMN_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  docs.forEach((doc) => {
    const detail = getDocDetailFields(doc);
    const category = doc.my_mark_category != null ? categoryById.get(doc.my_mark_category) : undefined;
    const row = ws.addRow([
      detail.line || '-',
      [detail.purpose || '-', ...detail.otherPurpose].join('\n'),
      detail.isAdiCd ? t('approval.step_na') : (detail.mapType || '-'),
      [detail.processSelection, detail.partidSelection, detail.processId].filter(Boolean).join(' · ') || '-',
      formatDateTime(getDocSubmittedDate(doc)),
      [doc.requester_name, doc.requester_department].filter(Boolean).join('\n'),
      stageToText(doc, t),
      category ? category.name : t('approval.category_none'),
    ]);
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'top', wrapText: true };
      if (category) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${category.color.replace('#', '')}` } };
        cell.font = { color: { argb: fontColorFor(category.color) } };
      }
    });
  });
};

/** '전체' 시트 + 선택한 라인마다 시트 1장. 라인 시트는 선택 순서(OPTION_LINE 순)대로 붙는다. */
export const exportApprovalList = async (
  docs: RequestDocument[],
  lines: string[],
  categories: PersonalMarkCategory[],
  t: TFunction,
): Promise<void> => {
  const sorted = [...docs].sort((a, b) => getDocSubmittedDate(a).localeCompare(getDocSubmittedDate(b)));
  const wb = new ExcelJS.Workbook();
  addListSheet(wb, t('approval.export_sheet_all'), sorted, categories, t);
  lines.forEach((line) => {
    addListSheet(wb, line, sorted.filter((d) => getDocDetailFields(d).line === line), categories, t);
  });
  await downloadWorkbook(wb, `${t('approval.export_file_prefix')}_${getNowString()}.xlsx`);
};
