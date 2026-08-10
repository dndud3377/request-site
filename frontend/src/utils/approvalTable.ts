// 결재 현황 테이블 계산 헬퍼 — ApprovalPage 와 HomePage(최근 의뢰 현황)가 동일한 표를 그리도록 공유한다.
import type { TFunction } from 'i18next';
import { RequestDocument, ApprovalStepFrontend } from '../types';
import { formatDate } from './date';
import { MAP_DELETE_EDIT_PURPOSE } from '../pages/RequestPage/constants';

/** 요청 목적이 'MAP 삭제/수정' 인가 — PagedDetailView 의 isOnlyMap/isMapDeleteEdit 과 동일한 판정 방식 */
const isMapDeleteEditDoc = (doc: RequestDocument): boolean => {
  try {
    const parsed = JSON.parse(doc.additional_notes ?? '{}');
    return parsed?.detail?.request_purpose === MAP_DELETE_EDIT_PURPOSE;
  } catch { return false; }
};

// R/P/E단계 하위 역할 라벨: R=단계명(RFG) 그대로 / RV·PV·EV=검토자 / RA=후결자, 그 외는 agent_* 사용
const stageLabel = (agent: string, t: TFunction): string => {
  if (agent === 'RV' || agent === 'PV' || agent === 'EV') return t('approval.stage_reviewer' as any);
  if (agent === 'RA') return t('approval.stage_post' as any);
  return t(`approval.agent_${agent}` as any);
};

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
  // MAP 삭제/수정 경로에서는 R 이 관문이 아니라 병렬 구성원이라 P/O 와 동시에 아직 pending 일 수 있다.
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
 *   PHPSI(P)       후결자(고정 RA)   ← MAP 삭제/수정 은 이 자리에 RFG(R)
 *   JOB(J)         MASK(E)
 *   OVL(O)         추가후결자(RA)
 *
 * 6칸은 항상 같은 자리에 있고, 이 문서의 결재 경로에 없는 단계는 '해당없음'으로 남는다.
 * (예전에는 존재하는 경로만 행으로 만들어서, 비대상 단계와 이미 끝난 단계가 화면에서 사라졌다.)
 * -------------------------------------------------------------------------- */

/** 그리드 칸 상태 — na(경로 밖) / wait(미선점) / review(진행 중) / done(완료) / pause(중단) */
export type StageCellState = 'na' | 'wait' | 'review' | 'done' | 'pause';

/** 그리드 칸 슬롯. GRID_SLOT_ORDER 의 순서가 곧 화면 배치(행 우선, 2열)다. */
export type StageCellSlot = 'P' | 'RA_FIXED' | 'J' | 'E' | 'O' | 'RA_EXTRA';

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
  /** grid 행의 6칸. 항상 GRID_SLOT_ORDER 순서·길이 6 */
  cells?: StageCell[];
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
  step: { agent: string; assignee_name?: string } | undefined,
  isDone: boolean,
  t: TFunction,
): string => {
  if (isDone) return t('common.status_approved');
  if (!step) return t('common.status_approved');
  const label = stageLabel(step.agent, t);
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
   * MAP 삭제/수정 의 RFG 칸만 'main' 이다.
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
  const fixedLoginid = (doc.post_approver_fixed_loginid ?? '').trim();
  const raSteps = of('RA');
  const fixedRaSteps = fixedLoginid ? raSteps.filter(s => s.assignee_loginid === fixedLoginid) : [];
  const extraRaSteps = fixedLoginid ? raSteps.filter(s => s.assignee_loginid !== fixedLoginid) : raSteps;

  // 중단 '요청중'(확정 전) 대상 단계에만 칩을 붙인다. 확정(pause)된 문서는 아래에서 전 칸을 덮는다.
  const pauseTargetIds = doc.pause_request?.state === 'requested'
    ? doc.pause_request.target_step_ids
    : [];

  const specs: Record<StageCellSlot, CellSpec> = {
    P: {
      slot: 'P', label: t('approval.agent_P' as any),
      main: of('P'), reviewers: of('PV'), showName: true,
    },
    // MAP 삭제/수정 은 후결자를 아예 만들지 않는 유일한 경로다. 대신 이 경로에서만 R 이
    // 관문이 아니라 P·J·O 와 동시에 도는 병렬 구성원이라, 비는 이 자리에 RFG 를 넣는다.
    RA_FIXED: isMde
      ? {
          slot: 'RA_FIXED', label: t('approval.agent_R' as any),
          main: of('R'), reviewers: of('RV'), showName: true, nameSource: 'main',
        }
      : {
          slot: 'RA_FIXED', label: t('approval.stage_post' as any),
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

  return GRID_SLOT_ORDER.map(slot => buildCell(specs[slot], pauseTargetIds));
};

/** 중단 확정(pause) 문서: 6칸을 전부 PAUSE 뱃지로 덮고 이름은 표시하지 않는다. */
const toPausedGrid = (cells: StageCell[]): StageCell[] =>
  cells.map(({ slot, label }) => ({ slot, label, state: 'pause' as const }));

export const getDocTableRows = (doc: RequestDocument, t: TFunction): DocTableRow[] => {
  const maxRound = getCurrentRound(doc);
  const currentSteps = (doc.approval_steps ?? []).filter(s => (s.round ?? 1) === maxRound);
  // 병렬 단계(P/O/E/RA) 시작 여부. MAP 삭제/수정 도 P·O 가 함께 생기므로 이 판정에 걸린다.
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
    const stageText = pending.length > 0
      ? pending.map(s => stageLabel(s.agent, t)).join(' / ')
      : '-';
    return [{ pathKey: 'single', stageText, isDone: false, pathStatus: 'pause' }];
  }

  // 반려: 문서 status 만 rejected 로 바뀌고 잔여 pending step 은 이력으로 남으므로,
  // 아래 진행 중 분기들이 그 잔여 단계를 '아직 진행 중'으로 오판한다(R 반려 후 검토자(RV)
  // 단계로 넘어간 것처럼 보이던 문제). 반려 시점의 단계명은 그대로 보여주되(어느 단계에서
  // 반려됐는지 알 수 있도록) 상태는 항상 rejected 로 고정한다.
  if (doc.status === 'rejected') {
    const rejectedSteps = currentSteps.filter(s => s.action === 'rejected');
    const stageText = rejectedSteps.length > 0
      ? rejectedSteps.map(s => buildStageText(s, false, t)).join(' / ')
      : '-';
    return [{ pathKey: 'single', stageText, isDone: true, pathStatus: 'rejected' }];
  }

  const pauseRequested = doc.pause_request?.state === 'requested';

  // PL 검토 단계 pending: R 단계 미생성 상태 (다중 PL은 아직 미합의자만 표시)
  const plPending = currentSteps.filter(s => s.agent === 'PL' && s.action === 'pending');
  if (plPending.length > 0) {
    const label = t('approval.agent_PL' as any);
    const names = plPending.map(s => s.assignee_name).filter(Boolean);
    const stageText = names.length > 0 ? `${label}(${names.join(' / ')})` : label;
    return [{ pathKey: 'single', stageText, isDone: false, pathStatus: 'under_review', pauseRequested }];
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
