import ExcelJS from 'exceljs';
import type { TFunction } from 'i18next';
import { RequestDocument, PersonalMarkCategory, Status } from '../types';
import { getCurrentRound, getDocDetailFields, getDocTableRows, getDocSubmittedDate, hasActiveStageStep } from './approvalTable';
import { formatDateTime } from './date';
import { downloadWorkbook, getNowString } from './detailExport';

/**
 * 결재 현황 목록 엑셀 다운로드(docs/APPROVAL.md '결재 현황 목록 다운로드').
 * 목록의 라인 ~ 현재 단계(상태/대기중/검토중/완료로 세분화) 컬럼 + 내 범주를 '전체' 시트와 선택한 라인별 시트로 나눠 담는다.
 */

/** 다운로드 창의 팀 필터 — 상단 단계별 탭(agent_R 등)과 같은 판정(hasActiveStageStep)을 쓴다. */
export const EXPORT_TEAMS = ['R', 'P', 'J', 'O', 'E'] as const;
export type ExportTeam = typeof EXPORT_TEAMS[number];

/** 임시저장은 결재에 올라가지 않은 문서라 다운로드 대상에서 항상 뺀다. */
const EXCLUDED_STATUS = 'draft';

const HEADER_FILL = 'FFE5E7EB';
const COLUMN_WIDTHS = [10, 18, 14, 36, 18, 22, 12, 24, 24, 20, 16];
const STATUS_REJECTED = 'rejected';
const STATUS_PAUSE = 'pause';
const STATUS_IN_PROGRESS: Status = 'under_review';
const R_AGENT = 'R';
/** 범주는 마지막 컬럼(1부터 센 번호) */
const CATEGORY_COL = COLUMN_WIDTHS.length;

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

/** 현재 단계를 대기중/검토중/완료 세 칸으로 나눈 값(칸마다 단계 하나가 한 줄). */
export interface StageColumns {
  waiting: string[];
  reviewing: string[];
  done: string[];
}

/**
 * 목록의 '현재 단계'를 대기중/검토중/완료로 나눈다 — 화면과 같은 getDocTableRows 결과를 분류한다.
 * - 완료: 화면 그리드의 '완료' 칸 + 이번 회차에서 합의가 끝난 R(RFG). PL·SA·RV 는 넣지 않는다.
 * - 반려: 반려된 단계를 검토중 칸에 둔다(그 단계를 검토하다 반려했으므로).
 * - 중단: 화면은 모든 칸을 PAUSE 로 덮어 원래 상태가 보이지 않으므로, 진행 중 문서로 보고
 *   단계 상태(대기중/검토중/완료)를 계산해 나눈다. 중단 여부는 '상태' 컬럼에 따로 적는다.
 */
export const splitStageColumns = (doc: RequestDocument, t: TFunction): StageColumns => {
  const cols: StageColumns = { waiting: [], reviewing: [], done: [] };
  const round = getCurrentRound(doc);
  const rDone = (doc.approval_steps ?? []).some(
    (s) => s.agent === R_AGENT && (s.round ?? 1) === round && s.action === 'approved',
  );
  if (rDone) cols.done.push(t('approval.agent_R'));

  const base = doc.status === STATUS_PAUSE ? { ...doc, status: STATUS_IN_PROGRESS } : doc;
  const row = getDocTableRows(base, t)[0];
  const chip = (on?: boolean) => (on ? ` ⏸ ${t('approval.pause_requested_chip')}` : '');
  if (row.cells) {
    row.cells.forEach((c) => {
      const text = `${c.label}${c.name ? `(${c.name})` : ''}${chip(c.pauseRequested)}`;
      if (c.state === 'wait') cols.waiting.push(text);
      else if (c.state === 'review') cols.reviewing.push(text);
      else if (c.state === 'done') cols.done.push(text);
    });
    return cols;
  }
  const text = `${row.stageText}${chip(row.pauseRequested)}`;
  if (doc.status === STATUS_REJECTED || row.pathStatus === STATUS_IN_PROGRESS) cols.reviewing.push(text);
  else if (row.pathStatus === 'unassigned') cols.waiting.push(text);
  return cols;
};

/** '상태' 컬럼 — 진행중/반려/중단, 철회 요청중이면 한 줄 덧붙인다. */
const statusText = (doc: RequestDocument, t: TFunction): string => {
  const status = doc.status === STATUS_REJECTED
    ? t('common.status_rejected')
    : doc.status === STATUS_PAUSE ? t('common.status_pause') : t('approval.export_status_in_progress');
  return doc.withdraw_request ? `${status}\n${t('approval.withdraw_requested_chip')}` : status;
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
    t('approval.export_col_status'),
    t('approval.export_col_waiting'),
    t('approval.export_col_reviewing'),
    t('approval.export_col_done'),
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
    const stage = splitStageColumns(doc, t);
    const row = ws.addRow([
      detail.line || '-',
      [detail.purpose || '-', ...detail.otherPurpose].join('\n'),
      detail.isAdiCd ? t('approval.step_na') : (detail.mapType || '-'),
      [detail.processSelection, detail.partidSelection, detail.processId].filter(Boolean).join(' · ') || '-',
      formatDateTime(getDocSubmittedDate(doc)),
      [doc.requester_name, doc.requester_department].filter(Boolean).join('\n'),
      statusText(doc, t),
      stage.waiting.join('\n'),
      stage.reviewing.join('\n'),
      stage.done.join('\n'),
      category ? category.name : t('approval.category_none'),
    ]);
    row.eachCell((cell) => { cell.alignment = { vertical: 'top', wrapText: true }; });
    // 범주는 범주 칸 글자만 그 범주 색으로 — 배경은 칠하지 않는다.
    if (category) row.getCell(CATEGORY_COL).font = { color: { argb: `FF${category.color.replace('#', '')}` } };
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
