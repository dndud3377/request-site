// 결재 현황 테이블 계산 헬퍼 — ApprovalPage 와 HomePage(최근 의뢰 현황)가 동일한 표를 그리도록 공유한다.
import type { TFunction } from 'i18next';
import { RequestDocument, ApprovalStepFrontend } from '../types';
import { formatDate } from './date';
import { MAP_DELETE_EDIT_PURPOSE, ADI_CD_CHANGE_PURPOSE } from '../pages/RequestPage/constants';

/** 요청 목적이 'MAP 삭제' 인가 — PagedDetailView 의 isOnlyMap/isMapDeleteEdit 과 동일한 판정 방식 */
const isMapDeleteEditDoc = (doc: RequestDocument): boolean => {
  try {
    const parsed = JSON.parse(doc.additional_notes ?? '{}');
    return parsed?.detail?.request_purpose === MAP_DELETE_EDIT_PURPOSE;
  } catch { return false; }
};

/* ===================== 결재 현황 목록 컬럼 분리(2026-08) =====================
 * '제목' 한 칸에 몰아 쓰던 라인·목적·MAP 목적·조합법/제품/조리법을 각자 컬럼으로 보여주기 위해
 * additional_notes(JSON)의 detail 을 파싱한다. 제목 문자열 조립 규칙(RequestPage/index.tsx
 * buildEnrichedForm)과 같은 출처를 그대로 읽을 뿐 별도로 저장하지 않는다.
 * -------------------------------------------------------------------------- */

/** MAP 목적 필터·정렬에서 'ADI CD 변경'처럼 map_type 자체가 없는 문서를 가리키는 값 */
export const MAP_PURPOSE_NA = '__NA__';

export interface DocDetailFields {
  line: string;
  /** 요청 목적 대분류(신규/차용/기타 등) */
  purpose: string;
  /** 기타 목적 세부 항목(Overlay 변경 등) — purpose 가 '기타'일 때만 값이 있다 */
  otherPurpose: string[];
  /** ADI CD 변경 문서는 map_type 자체가 없어 항상 빈 문자열이다 */
  mapType: string;
  isAdiCd: boolean;
  processSelection: string;
  partidSelection: string;
  processId: string;
  /** ADI CD 변경의 '동일 변경 적용 대상' 추가 건수(제목의 (+N) 배지와 동일) */
  adiExtraCount: number;
}

const EMPTY_DETAIL_FIELDS: DocDetailFields = {
  line: '', purpose: '', otherPurpose: [], mapType: '', isAdiCd: false,
  processSelection: '', partidSelection: '', processId: '', adiExtraCount: 0,
};

/** 결재 현황 목록의 라인/목적/MAP 목적/제품(조합법-제품-조리법) 컬럼용 값 — JSON 파싱 실패 시 빈 값 */
export const getDocDetailFields = (doc: RequestDocument): DocDetailFields => {
  try {
    const parsed = JSON.parse(doc.additional_notes ?? '{}');
    const d = parsed?.detail ?? {};
    const purpose: string = d.request_purpose ?? '';
    return {
      line: d.line ?? '',
      purpose,
      otherPurpose: Array.isArray(d.other_purpose) ? d.other_purpose : [],
      mapType: d.map_type ?? '',
      isAdiCd: purpose === ADI_CD_CHANGE_PURPOSE,
      processSelection: d.process_selection ?? '',
      partidSelection: d.partid_selection ?? '',
      processId: d.process_id ?? '',
      adiExtraCount: Array.isArray(d.adi_cd_extra_targets) ? d.adi_cd_extra_targets.length : 0,
    };
  } catch {
    return EMPTY_DETAIL_FIELDS;
  }
};

/** MAP 목적 필터·정렬 키 — ADI CD 변경 문서는 MAP_PURPOSE_NA 로 통일한다 */
export const getMapPurposeKey = (detail: DocDetailFields): string =>
  detail.isAdiCd ? MAP_PURPOSE_NA : detail.mapType;

/** 결재 현황 목록의 '요청일' 컬럼·정렬·필터 값 — 제목 문자열의 날짜를 파싱하지 않고
 * submittedSortKey 와 동일하게 실제 상신 시각(없으면 작성 시각)을 그대로 쓴다. */
export const getDocSubmittedDate = (doc: RequestDocument): string =>
  doc.submitted_at ?? doc.created_at ?? '';

/**
 * 단계 라벨. 검토자·후결자도 '검토자'/'후결자' 가 아니라 **그 단계의 이름**으로 표기한다(2026-08).
 * - `RV`(R단계 검토자) → `RFG` — 담당자든 검토자든 같은 R 단계다.
 * - `RA` 중 고정 후결자(.env POST_APPROVER_LOGINID)는 RFG 팀 1명이므로 → `RFG`
 * - `RA` 중 PL 이 지정한 추가 후결자 → `추가후결자`
 * PV/EV 는 병렬 그리드에서만 나타나고 거기서 이미 담당 단계명을 유지하므로 여기 오지 않는다.
 */
const stageLabel = (agent: string, t: TFunction, isFixedPostApprover = false): string => {
  if (agent === 'PV' || agent === 'EV') return t('approval.stage_reviewer' as any);
  if (agent === 'RV') return t('approval.agent_R' as any);
  if (agent === 'RA') {
    return isFixedPostApprover ? t('approval.agent_R' as any) : t('approval.stage_post_extra' as any);
  }
  return t(`approval.agent_${agent}` as any);
};

/** 이 step 의 담당자가 고정 후결자인지 (목록 응답의 post_approver_fixed_loginid 와 비교) */
const isFixedPostApproverStep = (
  step: { agent: string; assignee_loginid?: string },
  fixedLoginid: string,
): boolean => step.agent === 'RA' && !!fixedLoginid && step.assignee_loginid === fixedLoginid;

/** 문서의 고정 후결자 loginid (설정이 비어 있으면 빈 문자열 = 전부 추가 후결자로 본다) */
const fixedPostApproverLoginid = (doc: RequestDocument): string =>
  (doc.post_approver_fixed_loginid ?? '').trim();

// TE_O/TE_E/TE_P는 담당자 지정 불필요(검토중 방식) — 나머지 단계에서 담당자 미지정 시 'unassigned' 반환
export const getDisplayStatus = (doc: RequestDocument): string => {
  if (doc.status !== 'under_review') return doc.status;
  const steps = doc.approval_steps ?? [];
  const maxRound = steps.reduce((m, s) => Math.max(m, s.round ?? 1), 0) || 1;
  const pending = steps.filter((s) => (s.round ?? 1) === maxRound && s.action === 'pending');
  const needsAssignment = pending.some(
    (s) => s.agent !== 'O' && s.agent !== 'E' && s.agent !== 'P' && !s.assignee_loginid
  );
  return needsAssignment ? 'unassigned' : 'under_review';
};

export const getCurrentRound = (doc: RequestDocument): number =>
  (doc.approval_steps ?? []).reduce((m, s) => Math.max(m, s.round ?? 1), 0) || 1;

export interface LastRejectionInfo {
  round: number;
  stageLabel: string;
  rejectedAt?: string;
}

/**
 * 재상신된 문서에서 가장 최근에 반려됐던 회차·단계 1건만 반환한다(전체 회차를 나열하지 않는다).
 * 재상신은 항상 직전 회차의 반려로만 일어나므로(round+1) currentRound-1 회차만 보면 된다.
 * 문서가 지금 반려 상태(status='rejected')면 '현재 단계' 칸에 이미 반려가 표시되므로 null.
 */
export const getLastRejectionInfo = (doc: RequestDocument, t: TFunction): LastRejectionInfo | null => {
  if (doc.status === 'rejected') return null;
  const currentRound = getCurrentRound(doc);
  if (currentRound <= 1) return null;
  const prevRound = currentRound - 1;
  const fixedLoginid = fixedPostApproverLoginid(doc);
  const rejectedSteps = (doc.approval_steps ?? []).filter(
    (s) => (s.round ?? 1) === prevRound && s.action === 'rejected'
  );
  if (rejectedSteps.length === 0) return null;
  const label = Array.from(new Set(
    rejectedSteps.map((s) => stageLabel(s.agent, t, isFixedPostApproverStep(s, fixedLoginid)))
  )).join(' · ');
  const rejectedAt = rejectedSteps
    .map((s) => s.acted_at)
    .filter((v): v is string => !!v)
    .sort()
    .slice(-1)[0];
  return { round: prevRound, stageLabel: label, rejectedAt };
};

// 최종 완료 예상일: max(path0_end(R), path1_end, path2_end, path3_end(후결자))
// 단계별 완료예정일은 화면에서 제거했지만(2026-08), 이 '최종 완료예정' 한 칸은 남으므로
// step.due_date 자체는 계속 사용한다.
export const getFinalCompletionDate = (doc: RequestDocument): string => {
  // 반려된 문서는 잔여 pending step 의 due_date 가 남아 있어도 진행 예정이 아니다.
  if (doc.status === 'rejected') return '-';
  const maxRound = getCurrentRound(doc);
  const currentSteps = (doc.approval_steps ?? []).filter(s => (s.round ?? 1) === maxRound);
  // 병렬 단계(P/O/E/RA)가 시작돼야 최종 완료예정 산출 가능
  const parallelPresent = currentSteps.some(s => ['P', 'O', 'E', 'RA'].includes(s.agent));
  if (!parallelPresent) return '-';

  const pStep = currentSteps.find(s => s.agent === 'P');
  const jStep = currentSteps.find(s => s.agent === 'J');
  const oStep = currentSteps.find(s => s.agent === 'O');
  const eStep = currentSteps.find(s => s.agent === 'E');
  const raSteps = currentSteps.filter(s => s.agent === 'RA');
  // MAP 삭제 경로에서는 R 이 관문이 아니라 병렬 구성원이라 P/O 와 동시에 아직 pending 일 수 있다.
  // 기존 경로(일반·Only MAP)는 R 합의가 끝나야만 parallelPresent 가 되므로 이 값은 항상 없다(영향 없음).
  const rStep = currentSteps.find(s => s.agent === 'R');
  const rvStep = currentSteps.find(s => s.agent === 'RV');

  // path0: R(+RV). due 는 다른 경로와 동일하게 완료 여부와 무관하게 후보에 넣는다.
  const path0Dates = [rStep?.due_date, rvStep?.due_date].filter(Boolean) as string[];
  const path0End = path0Dates.length > 0 ? path0Dates.reduce((a, b) => (a > b ? a : b)) : null;

  // path2: max(J.due, O.due, E.due) — J 는 P 뒤 순차가 아니라 O/E 와 같은 병렬 단계다(2026-08).
  const path2Dates = [jStep?.due_date, oStep?.due_date, eStep?.due_date].filter(Boolean) as string[];
  const path2End = path2Dates.length > 0 ? path2Dates.reduce((a, b) => (a > b ? a : b)) : null;

  // path1: P.due.
  const path1End: string | null = pStep?.due_date ?? null;

  // path3: 후결자(RA) 최대 due
  const raDates = raSteps.map(s => s.due_date).filter(Boolean) as string[];
  const path3End = raDates.length > 0 ? raDates.reduce((a, b) => (a > b ? a : b)) : null;

  const candidates = [path0End, path1End, path2End, path3End].filter(Boolean) as string[];
  if (candidates.length === 0) return '-';
  return formatDate(candidates.reduce((a, b) => (a > b ? a : b)));
};

/* ===================== 병렬 합의 단계 그리드 (2026-08) =====================
 * 병렬 진입 후에는 경로별로 행을 쪼개지 않고 문서 1건을 표 1행으로 두고,
 * '현재 단계' 칸 안에 3행 2열 고정 그리드를 그린다.
 *
 *   1열            2열
 *   PHPSI(P)       후결자(고정 RA)   ← MAP 삭제 은 이 자리에 RFG(R)
 *   JOB(J)         MASK(E)
 *   OVL(O)         추가후결자(RA)
 *
 * 6칸은 항상 같은 자리에 있고, 이 문서의 결재 경로에 없는 단계는 '해당없음'으로 남는다.
 * (예전에는 존재하는 경로만 행으로 만들어서, 비대상 단계와 이미 끝난 단계가 화면에서 사라졌다.)
 * -------------------------------------------------------------------------- */

/** 그리드 칸 상태 — na(경로 밖) / wait(미선점) / review(진행 중) / done(완료) / pause(중단) */
export type StageCellState = 'na' | 'wait' | 'review' | 'done' | 'pause';

/** 그리드 칸 슬롯. GRID_SLOT_ORDER 의 순서가 곧 화면 배치(행 우선, 2열)다. */
export type StageCellSlot = 'P' | 'RA_FIXED' | 'J' | 'E' | 'O' | 'RA_EXTRA' | 'PL' | 'SA';

const GRID_SLOT_ORDER: StageCellSlot[] = ['P', 'RA_FIXED', 'J', 'E', 'O', 'RA_EXTRA'];

export interface StageCell {
  slot: StageCellSlot;
  /** 단계명. 담당자가 검토자로 넘어가도 이 라벨은 바뀌지 않는다. */
  label: string;
  /** 표시할 이름. 대기중·완료 칸과 이름을 숨기는 단계(J·O)는 undefined */
  name?: string;
  state: StageCellState;
  /** 중단 '요청중'(확정 전) 대상 단계면 true — 해당 칸에만 칩을 붙인다 */
  pauseRequested?: boolean;
}

export interface DocTableRow {
  /** single = 병렬 이전·반려 등 기존 단일 행 / grid = 병렬 합의 단계 3행 2열 */
  pathKey: 'single' | 'grid';
  /** single 행의 현재 단계 텍스트 (grid 행에서는 사용하지 않는다) */
  stageText: string;
  isDone: boolean;
  /** single 행의 대표 상태 (StatusBadge 에 전달, grid 행에서는 사용하지 않는다) */
  pathStatus: string;
  /** grid 행의 칸. 병렬 합의 단계는 GRID_SLOT_ORDER 순서·길이 6, PL 검토 단계는 PL/SA 2칸 */
  cells?: StageCell[];
  /** grid 행의 열 수. 병렬 합의 단계는 2열, PL 검토 단계는 1열(두 줄) */
  gridColumns?: 1 | 2;
  /** single 행에 '중단 요청중' 칩을 붙일지 */
  pauseRequested?: boolean;
}

// 경로별 상태 계산: pending의 assignee 여부에 따라 unassigned / under_review / approved
export const resolvePathStatus = (
  pendingStep: { agent: string; assignee_loginid?: string } | undefined,
  isDone: boolean,
  docStatus: string,
): string => {
  if (docStatus === 'rejected') return 'rejected';
  if (isDone) return 'approved';
  if (!pendingStep) return 'approved';
  return pendingStep.assignee_loginid ? 'under_review' : 'unassigned';
};

const buildStageText = (
  step: { agent: string; assignee_name?: string; assignee_loginid?: string } | undefined,
  isDone: boolean,
  t: TFunction,
  fixedLoginid = '',
): string => {
  if (isDone) return t('common.status_approved');
  if (!step) return t('common.status_approved');
  const label = stageLabel(step.agent, t, isFixedPostApproverStep(step, fixedLoginid));
  return step.assignee_name ? `${label}(${step.assignee_name})` : label;
};

/** 이름을 ' / ' 로 연결. 이름이 하나도 없으면 undefined */
const joinNames = (steps: ApprovalStepFrontend[]): string | undefined => {
  const names = steps.map(s => s.assignee_name).filter(Boolean) as string[];
  return names.length > 0 ? names.join(' / ') : undefined;
};

interface CellSpec {
  slot: StageCellSlot;
  label: string;
  /** 담당자 단계들 (없으면 이 문서의 경로에 없는 단계 = 해당없음) */
  main: ApprovalStepFrontend[];
  /** 검토자 단계들 (PV/EV/RV) */
  reviewers?: ApprovalStepFrontend[];
  /** 이름을 표시하는 단계인가 — J·O 는 진행 중 이름을 노출하지 않는다(기존 비대칭 규칙 유지) */
  showName: boolean;
  /**
   * 담당자 합의 후 검토자가 남았을 때 어느 이름을 쓸지.
   * 'reviewer'(기본) = 미합의 검토자 이름으로 교체 / 'main' = 담당자 이름 고정
   * MAP 삭제 의 RFG 칸만 'main' 이다.
   */
  nameSource?: 'reviewer' | 'main';
}

/**
 * 칸 하나를 계산한다.
 * - 담당자 단계가 없으면 해당없음
 * - 담당자+검토자 전원 합의면 완료(이름 표시 안 함)
 * - 담당자가 pending 이면 선점 여부로 대기중/검토중
 * - 담당자만 끝나고 검토자가 남았으면 검토중 + (기본) 미합의 검토자 이름
 * 대기중·완료 칸은 이름을 표시하지 않는다.
 */
const buildCell = (spec: CellSpec, pauseTargetIds: number[]): StageCell => {
  const { slot, label, main, showName } = spec;
  const reviewers = spec.reviewers ?? [];
  if (main.length === 0) return { slot, label, state: 'na' };

  const pendingMain = main.filter(s => s.action === 'pending');
  const pendingReviewers = reviewers.filter(s => s.action === 'pending');
  const pendingIds = [...pendingMain, ...pendingReviewers].map(s => s.id);
  const pauseRequested = pendingIds.some(id => pauseTargetIds.includes(id));
  const withChip = (cell: StageCell): StageCell =>
    pauseRequested ? { ...cell, pauseRequested: true } : cell;

  if (pendingMain.length === 0 && pendingReviewers.length === 0) {
    return { slot, label, state: 'done' };
  }

  if (pendingMain.length > 0) {
    // 여럿이 pending 이면(J 다중 배정 등) 한 명이라도 선점됐을 때 검토중으로 본다.
    const assigned = pendingMain.filter(s => s.assignee_loginid);
    if (assigned.length === 0) return withChip({ slot, label, state: 'wait' });
    return withChip({ slot, label, state: 'review', name: showName ? joinNames(assigned) : undefined });
  }

  // 담당자는 합의했고 검토자가 남았다 — 단계명은 그대로 두고 이름만 바꾼다.
  const nameSteps = spec.nameSource === 'main' ? main : pendingReviewers;
  return withChip({ slot, label, state: 'review', name: showName ? joinNames(nameSteps) : undefined });
};

/** 병렬 합의 단계의 6칸을 계산한다. 반환 배열은 항상 GRID_SLOT_ORDER 순서·길이 6. */
const buildParallelGrid = (
  doc: RequestDocument,
  currentSteps: ApprovalStepFrontend[],
  t: TFunction,
): StageCell[] => {
  const isMde = isMapDeleteEditDoc(doc);
  const of = (agent: string) => currentSteps.filter(s => s.agent === agent);

  // 고정 후결자(.env POST_APPROVER_LOGINID)와 PL 이 지정한 추가 후결자를 분리한다.
  // 고정 loginid 를 못 받은 경우(설정 없음)엔 전부 추가 후결자로 본다.
  const fixedLoginid = fixedPostApproverLoginid(doc);
  const raSteps = of('RA');
  const fixedRaSteps = fixedLoginid ? raSteps.filter(s => s.assignee_loginid === fixedLoginid) : [];
  const extraRaSteps = fixedLoginid ? raSteps.filter(s => s.assignee_loginid !== fixedLoginid) : raSteps;

  // 중단 '요청중'(확정 전) 대상 단계에만 칩을 붙인다. 확정(pause)된 문서는 아래에서 전 칸을 덮는다.
  const pauseTargetIds = doc.pause_request?.state === 'requested'
    ? doc.pause_request.target_step_ids
    : [];

  // PL/SA 는 병렬 합의 단계가 아니라 그 앞 PL 검토 단계의 칸이라 여기 오지 않는다.
  const specs: Record<Exclude<StageCellSlot, 'PL' | 'SA'>, CellSpec> = {
    P: {
      slot: 'P', label: t('approval.agent_P' as any),
      main: of('P'), reviewers: of('PV'), showName: true,
    },
    // MAP 삭제 은 후결자를 아예 만들지 않는 유일한 경로다. 대신 이 경로에서만 R 이
    // 관문이 아니라 P·J·O 와 동시에 도는 병렬 구성원이라, 비는 이 자리에 RFG 를 넣는다.
    RA_FIXED: isMde
      ? {
          slot: 'RA_FIXED', label: t('approval.agent_R' as any),
          main: of('R'), reviewers: of('RV'), showName: true, nameSource: 'main',
        }
      : {
          // 고정 후결자는 .env 로 지정하는 RFG 팀 1명이라 단계명도 RFG 로 쓴다(2026-08).
          // 일반 경로 그리드에는 RFG 담당자 칸이 따로 없어 이름이 겹치지 않는다.
          slot: 'RA_FIXED', label: t('approval.agent_R' as any),
          main: fixedRaSteps, showName: true,
        },
    // J·O 는 검토중(claim) 방식이라 진행 중 담당자 이름을 노출하지 않는다(기존 규칙 유지).
    J: { slot: 'J', label: t('approval.agent_J' as any), main: of('J'), showName: false },
    E: {
      slot: 'E', label: t('approval.agent_E' as any),
      main: of('E'), reviewers: of('EV'), showName: true,
    },
    O: { slot: 'O', label: t('approval.agent_O' as any), main: of('O'), showName: false },
    RA_EXTRA: {
      slot: 'RA_EXTRA', label: t('approval.stage_post_extra' as any),
      main: extraRaSteps, showName: true,
    },
  };

  return GRID_SLOT_ORDER.map(slot => buildCell(specs[slot as Exclude<StageCellSlot, 'PL' | 'SA'>], pauseTargetIds));
};

/**
 * PL 검토 단계의 2칸(세로 2줄)을 계산한다 — 1줄 PL 지정 검토자 / 2줄 영업·기술지원 합의자.
 * 둘은 병렬이라 한쪽이 끝나도 다른 쪽이 남아 있으면 단계가 이어진다.
 * 합의자를 지정하지 않은 의뢰서는 SA 단계 자체가 없어 '해당없음'으로 남는다.
 */
export const PL_STAGE_SLOT_ORDER: StageCellSlot[] = ['PL', 'SA'];

const buildPlStageGrid = (
  currentSteps: ApprovalStepFrontend[],
  t: TFunction,
  pauseTargetIds: number[],
): StageCell[] => {
  const of = (agent: string) => currentSteps.filter(s => s.agent === agent);
  const specs: Record<'PL' | 'SA', CellSpec> = {
    PL: { slot: 'PL', label: t('approval.agent_PL' as any), main: of('PL'), showName: true },
    SA: { slot: 'SA', label: t('approval.agent_SA' as any), main: of('SA'), showName: true },
  };
  return PL_STAGE_SLOT_ORDER.map(slot => buildCell(specs[slot as 'PL' | 'SA'], pauseTargetIds));
};

/** 중단 확정(pause) 문서: 6칸을 전부 PAUSE 뱃지로 덮고 이름은 표시하지 않는다. */
const toPausedGrid = (cells: StageCell[]): StageCell[] =>
  cells.map(({ slot, label }) => ({ slot, label, state: 'pause' as const }));

export const getDocTableRows = (doc: RequestDocument, t: TFunction): DocTableRow[] => {
  const maxRound = getCurrentRound(doc);
  const currentSteps = (doc.approval_steps ?? []).filter(s => (s.round ?? 1) === maxRound);
  // 병렬 단계(P/O/E/RA) 시작 여부. MAP 삭제 도 P·O 가 함께 생기므로 이 판정에 걸린다.
  const parallelPresent = currentSteps.some(s => ['P', 'O', 'E', 'RA'].includes(s.agent));

  // 중단(PAUSE): 병렬 진입 후면 그리드 전 칸을 PAUSE 로, 그 이전이면 기존 단일 행으로 보여준다.
  if (doc.status === 'pause') {
    if (parallelPresent) {
      return [{
        pathKey: 'grid',
        stageText: '',
        isDone: false,
        pathStatus: 'pause',
        cells: toPausedGrid(buildParallelGrid(doc, currentSteps, t)),
      }];
    }
    const pending = currentSteps.filter(s => s.action === 'pending');
    const fixedLoginid = fixedPostApproverLoginid(doc);
    const stageText = pending.length > 0
      ? pending.map(s => stageLabel(s.agent, t, isFixedPostApproverStep(s, fixedLoginid))).join(' / ')
      : '-';
    return [{ pathKey: 'single', stageText, isDone: false, pathStatus: 'pause' }];
  }

  // 반려: 문서 status 만 rejected 로 바뀌고 잔여 pending step 은 이력으로 남으므로,
  // 아래 진행 중 분기들이 그 잔여 단계를 '아직 진행 중'으로 오판한다(R 반려 후 검토자(RV)
  // 단계로 넘어간 것처럼 보이던 문제). 반려 시점의 단계명은 그대로 보여주되(어느 단계에서
  // 반려됐는지 알 수 있도록) 상태는 항상 rejected 로 고정한다.
  if (doc.status === 'rejected') {
    const rejectedSteps = currentSteps.filter(s => s.action === 'rejected');
    const rejectedFixedLoginid = fixedPostApproverLoginid(doc);
    const stageText = rejectedSteps.length > 0
      ? rejectedSteps.map(s => buildStageText(s, false, t, rejectedFixedLoginid)).join(' / ')
      : '-';
    return [{ pathKey: 'single', stageText, isDone: true, pathStatus: 'rejected' }];
  }

  const pauseRequested = doc.pause_request?.state === 'requested';

  // PL 검토 단계 진행 중: R 단계 미생성 상태.
  // (2026-08) PL 지정 검토자와 영업/기술지원 합의자(SA)가 병렬이라 한 줄로는 표현할 수 없어
  // 병렬 합의 단계와 같은 방식의 그리드(1열 2줄)로 그린다. 한쪽이 끝나고 다른 쪽이 남아 있어도
  // 단계는 계속 진행 중이므로 PL·SA 중 하나라도 pending 이면 이 분기를 탄다.
  const plStagePending = currentSteps.some(
    s => (s.agent === 'PL' || s.agent === 'SA') && s.action === 'pending'
  );
  if (plStagePending) {
    const pauseTargetIds = pauseRequested ? (doc.pause_request?.target_step_ids ?? []) : [];
    return [{
      pathKey: 'grid',
      stageText: '',
      isDone: false,
      pathStatus: 'under_review',
      cells: buildPlStageGrid(currentSteps, t, pauseTargetIds),
      gridColumns: 1,
      pauseRequested,
    }];
  }

  if (!parallelPresent) {
    // R단계: 담당자(R) → 검토자(RV) 순차. 병렬 진입 이전 구간은 기존 표시를 그대로 유지한다.
    const rStep = currentSteps.find(s => s.agent === 'R');
    const rvStep = currentSteps.find(s => s.agent === 'RV');
    if (rStep && rStep.action === 'pending') {
      return [{
        pathKey: 'single',
        stageText: buildStageText(rStep, false, t),
        isDone: false,
        pathStatus: rStep.assignee_loginid ? 'under_review' : 'unassigned',
        pauseRequested,
      }];
    }
    if (rvStep && rvStep.action === 'pending') {
      return [{
        pathKey: 'single',
        stageText: buildStageText(rvStep, false, t),
        isDone: false,
        pathStatus: rvStep.assignee_loginid ? 'under_review' : 'unassigned',
        pauseRequested,
      }];
    }
    return [{
      pathKey: 'single',
      stageText: doc.status === 'approved' ? t('common.status_approved') : '-',
      isDone: true,
      pathStatus: doc.status,
    }];
  }

  // 병렬 합의 단계 — 3행 2열 그리드 한 행
  const cells = buildParallelGrid(doc, currentSteps, t);
  return [{
    pathKey: 'grid',
    stageText: '',
    isDone: cells.every(c => c.state === 'done' || c.state === 'na'),
    pathStatus: doc.status,
    cells,
  }];
};

/* ===================== '내 차례'(MY) 판정 — 2026-08 공용화 =====================
 * 결재현황 MY 탭과 홈 '나의 의뢰 현황'이 **같은 목록**을 보여주도록 판정을 여기로 옮겼다.
 * -------------------------------------------------------------------------- */

/**
 * '내 차례'·단계별 필터 판정: 진행 중(under_review) 문서의 **현재 회차** pending 단계만 본다.
 * 반려된 문서는 status 만 rejected 로 바뀌고 잔여 pending step 이 이력으로 남으며, 재상신하면
 * 이전 회차 step 도 pending 인 채로 남는다. 이를 걸러내지 않으면 이미 끝난 문서가 계속
 * '내 차례'와 단계 탭(및 탭 카운트)에 잡힌다.
 */
export const hasActivePendingStep = (
  doc: RequestDocument,
  match: (step: ApprovalStepFrontend) => boolean,
): boolean => {
  if (doc.status !== 'under_review') return false;
  const round = getCurrentRound(doc);
  return (doc.approval_steps ?? []).some(
    (s) => s.action === 'pending' && (s.round ?? 1) === round && match(s)
  );
};

/**
 * 검토 항목 때문에 MY 에 떠야 하는 문서인지.
 * 조건: 진행 중 + 현재 회차 J 단계가 대기 + 내가 검토자인 미확인 항목이 1건 이상.
 * 기존 MY 조건(내가 담당자인 pending 단계)과는 OR 로 합쳐진다.
 */
export const hasMyPendingReviewItem = (doc: RequestDocument): boolean =>
  (doc.my_pending_review_items ?? 0) > 0 &&
  hasActivePendingStep(doc, (s) => s.agent === 'J');

export interface MyFilterUser {
  role?: string | null;
  /** loginid */
  username: string;
  name: string;
}

/**
 * MY('내 차례') 판정 — 결재현황 MY 탭과 홈 '나의 의뢰 현황'이 공유한다.
 *
 * - MASTER: 전체
 * - NONE/역할 없음: 없음
 * - PL: **내가 작성한 문서**(상태 무관) OR **내가 담당인 현재 회차 pending 단계가 있는 문서**
 *   ✅ (2026-08) 예전에는 `designated_pl_loginid` 와 PL step 존재만 봐서 ① PL 이 **추가
 *   후결자(RA)로 지정된 문서**가 안 잡히고 ② **이미 합의를 마친 문서도 계속 남아** 있었다.
 *   pending 단계 기준으로 바꿔 둘 다 해결한다(그 대신 반려·임시저장 문서에서 '내가 지정 PL'
 *   이라는 이유만으로 뜨던 건은 빠진다 — 반려는 별도 탭이 있고, MY 는 진행 중 문서만 본다).
 * - TE_*: 내가 담당인 pending 단계가 있는 문서 OR 내가 검토자인 미확인 검토 항목이 있는 문서
 */
export const isMyDocument = (doc: RequestDocument, user: MyFilterUser): boolean => {
  const role = user.role;
  if (role === 'MASTER') return true;
  if (role === 'NONE' || !role) return false;
  if (role === 'PL') {
    return doc.requester_name === user.name
      || hasActivePendingStep(doc, (s) => s.assignee_loginid === user.username);
  }
  return hasActivePendingStep(doc, (s) => s.assignee_loginid === user.username)
    || hasMyPendingReviewItem(doc);
};

/** 상신 오래된 순 정렬 키 — submitted_at 없는 draft 는 created_at 으로 대체(결재현황 기본 정렬과 동일) */
export const submittedSortKey = (doc: RequestDocument): string =>
  doc.submitted_at ?? doc.created_at ?? '';
