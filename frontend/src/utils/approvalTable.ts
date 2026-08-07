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

// due_date 텍스트 + CSS 클래스 반환
export const getDueDateDisplay = (
  dueDate: string | null | undefined,
  isDone: boolean,
  undecidedLabel: string,
): { text: string; cls: string } => {
  if (isDone) return { text: dueDate ? formatDate(dueDate) : '-', cls: 'due-date-done' };
  if (!dueDate) return { text: undecidedLabel, cls: 'due-date-undecided' };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate); due.setHours(0, 0, 0, 0);
  if (due < today) return { text: formatDate(dueDate), cls: 'due-date-overdue' };
  if (due.getTime() === today.getTime()) return { text: formatDate(dueDate), cls: 'due-date-today' };
  return { text: formatDate(dueDate), cls: '' };
};

// 최종 완료 예상일: max(path0_end(R), path1_end, path2_end, path3_end(후결자))
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

  // path2: max(O.due, E.due)
  const path2Dates = [oStep?.due_date, eStep?.due_date].filter(Boolean) as string[];
  const path2End = path2Dates.length > 0 ? path2Dates.reduce((a, b) => (a > b ? a : b)) : null;

  // path1: J.due or estimated (P.due + 4 calendar days)
  let path1End: string | null = null;
  if (jStep?.due_date) {
    path1End = jStep.due_date;
  } else if (pStep?.due_date) {
    const d = new Date(pStep.due_date);
    d.setDate(d.getDate() + 4);
    path1End = d.toISOString().slice(0, 10);
  }

  // path3: 후결자(RA) 최대 due
  const raDates = raSteps.map(s => s.due_date).filter(Boolean) as string[];
  const path3End = raDates.length > 0 ? raDates.reduce((a, b) => (a > b ? a : b)) : null;

  const candidates = [path0End, path1End, path2End, path3End].filter(Boolean) as string[];
  if (candidates.length === 0) return '-';
  return formatDate(candidates.reduce((a, b) => (a > b ? a : b)));
};

export interface DocSubStage {
  label: string;
  state: 'wait' | 'review' | 'done';
  name?: string;
}

export interface DocTableRow {
  pathKey: 'single' | 'path1' | 'path2' | 'path3' | 'parallel4';
  stageText: string;
  dueDate: string | null;
  isDone: boolean;
  pathStatus: string; // 경로별 상태 (StatusBadge에 전달)
  // 경로2(O+E)가 진행 중일 때만 채워짐 — O/E 개별 상태를 상태점으로 보여주기 위함(§3.3 참고)
  subStages?: DocSubStage[];
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

export const getDocTableRows = (doc: RequestDocument, t: TFunction): DocTableRow[] => {
  const maxRound = getCurrentRound(doc);
  const currentSteps = (doc.approval_steps ?? []).filter(s => (s.round ?? 1) === maxRound);

  // 중단(PAUSE): 멈춘 단계를 그대로 보여준다 (PAUSE 뱃지 + 현재 단계 텍스트).
  if (doc.status === 'pause') {
    const pending = currentSteps.filter(s => s.action === 'pending');
    const stageText = pending.length > 0
      ? pending.map(s => stageLabel(s.agent, t)).join(' / ')
      : '-';
    return [{
      pathKey: 'single',
      stageText,
      dueDate: pending[0]?.due_date ?? null,
      isDone: false,
      pathStatus: 'pause',
    }];
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
    return [{
      pathKey: 'single',
      stageText,
      dueDate: null,
      isDone: true,
      pathStatus: 'rejected',
    }];
  }

  // PL 검토 단계 pending: 기한 없음, R 단계 미생성 상태 (다중 PL은 아직 미합의자만 표시)
  const plPending = currentSteps.filter(s => s.agent === 'PL' && s.action === 'pending');
  if (plPending.length > 0) {
    const label = t('approval.agent_PL' as any);
    const names = plPending.map(s => s.assignee_name).filter(Boolean);
    const stageText = names.length > 0 ? `${label}(${names.join(' / ')})` : label;
    return [{
      pathKey: 'single',
      stageText,
      dueDate: null,
      isDone: false,
      pathStatus: 'under_review',
    }];
  }

  // 병렬 단계(P/O/E/RA) 시작 여부
  const parallelPresent = currentSteps.some(s => ['P', 'O', 'E', 'RA'].includes(s.agent));

  if (!parallelPresent) {
    // R단계: 담당자(R) → 검토자(RV) 순차
    const rStep = currentSteps.find(s => s.agent === 'R');
    const rvStep = currentSteps.find(s => s.agent === 'RV');
    if (rStep && rStep.action === 'pending') {
      return [{
        pathKey: 'single',
        stageText: buildStageText(rStep, false, t),
        dueDate: rStep.due_date ?? null,
        isDone: false,
        pathStatus: rStep.assignee_loginid ? 'under_review' : 'unassigned',
      }];
    }
    if (rvStep && rvStep.action === 'pending') {
      return [{
        pathKey: 'single',
        stageText: buildStageText(rvStep, false, t),
        dueDate: rvStep.due_date ?? null,
        isDone: false,
        pathStatus: rvStep.assignee_loginid ? 'under_review' : 'unassigned',
      }];
    }
    return [{
      pathKey: 'single',
      stageText: doc.status === 'approved' ? t('common.status_approved') : '-',
      dueDate: null,
      isDone: true,
      pathStatus: doc.status,
    }];
  }

  // 병렬 단계: 경로1(P[→검토자 PV]→J) ∥ 경로2(O[+E[→검토자 EV]]) ∥ 경로3(후결자 RA). 존재하는 경로만 행으로 만든다.
  // (반려 문서는 위 rejected 분기에서 이미 반환되므로 아래 경로별 상태 계산에서는 다시 확인하지 않는다.)
  const rows: DocTableRow[] = [];
  const pStep = currentSteps.find(s => s.agent === 'P');
  const pvSteps = currentSteps.filter(s => s.agent === 'PV');
  const jSteps = currentSteps.filter(s => s.agent === 'J');
  const oStep = currentSteps.find(s => s.agent === 'O');
  const eStep = currentSteps.find(s => s.agent === 'E');
  const evSteps = currentSteps.filter(s => s.agent === 'EV');
  const raSteps = currentSteps.filter(s => s.agent === 'RA');
  // MAP 삭제/수정 경로 전용 — R 이 관문이 아니라 병렬 구성원이라 P/O 와 동시에 pending 일 수 있다.
  // 기존 경로(일반·Only MAP)는 parallelPresent 가 될 때 R 이 이미 항상 approved 라 아래 조건이 걸리지 않는다.
  const rStep = currentSteps.find(s => s.agent === 'R');
  const rvStep = currentSteps.find(s => s.agent === 'RV');

  // 완료된 단계들의 '라벨(이름)'을 모아 " / "로 연결. 하나도 이름이 없으면 undefined(호출부에서 기본 문구로 대체).
  const namedApprovers = (steps: { agent: string; assignee_name?: string }[]): string | undefined => {
    const parts = steps
      .filter(s => s.assignee_name)
      .map(s => `${stageLabel(s.agent, t)}(${s.assignee_name})`);
    return parts.length > 0 ? parts.join(' / ') : undefined;
  };

  // MAP 삭제/수정 전용: P·R·J·O 네 단계가 진짜 동시 병렬이라 기존 path0~3(경로별 개별 행) 대신
  // 하나의 행에 "(R/J/P/O)" 형태로 모아 보여주고, 각 단계가 끝날 때마다 글자를 하나씩 지운다.
  if (isMapDeleteEditDoc(doc)) {
    const stepDone = (s?: ApprovalStepFrontend) => s?.action === 'approved';
    const stepUnassigned = (s?: ApprovalStepFrontend) => !!s && s.action === 'pending' && !s.assignee_loginid;

    const jPendingSteps = jSteps.filter(s => s.action === 'pending');
    const pvPendingSteps = pvSteps.filter(s => s.action === 'pending');

    const doneMap: Record<'R' | 'J' | 'P' | 'O', boolean> = {
      R: stepDone(rStep) && (!rvStep || stepDone(rvStep)),
      J: jSteps.length > 0 && jSteps.every(s => s.action === 'approved'),
      P: stepDone(pStep) && pvPendingSteps.length === 0,
      O: stepDone(oStep),
    };
    const unassignedMap: Record<'R' | 'J' | 'P' | 'O', boolean> = {
      R: stepUnassigned(rStep),
      J: jPendingSteps.some(s => !s.assignee_loginid),
      P: stepUnassigned(pStep),
      O: stepUnassigned(oStep),
    };
    // 표시 순서는 요청 그대로 R → J → P → O 고정(담당자 지정 여부로 구분하지 않는다).
    const order: ('R' | 'J' | 'P' | 'O')[] = ['R', 'J', 'P', 'O'];
    const remaining = order.filter(a => !doneMap[a]);

    if (remaining.length === 0) {
      // 네 단계 모두 끝났다 — 다른 경로가 완료 시 이름을 전부 드러내는 것과 동일하게 처리.
      const allMainSteps = [rStep, pStep, ...jSteps, oStep].filter(Boolean) as ApprovalStepFrontend[];
      const allReviewSteps = [rvStep, ...pvSteps].filter(Boolean) as ApprovalStepFrontend[];
      return [{
        pathKey: 'parallel4',
        stageText: namedApprovers([...allMainSteps, ...allReviewSteps]) ?? t('common.status_approved'),
        dueDate: null,
        isDone: true,
        pathStatus: 'approved',
      }];
    }

    const anyUnassigned = remaining.some(a => unassignedMap[a]);
    const dueCandidates = [rStep?.due_date, pStep?.due_date, ...jSteps.map(s => s.due_date), oStep?.due_date]
      .filter(Boolean) as string[];
    return [{
      pathKey: 'parallel4',
      stageText: `(${remaining.join('/')})`,
      dueDate: dueCandidates.length > 0 ? dueCandidates.reduce((a, b) => (a > b ? a : b)) : null,
      isDone: false,
      pathStatus: anyUnassigned ? 'unassigned' : 'under_review',
    }];
  }

  // ⚠️ R 이 병렬 진입 후에도 pending 으로 남는 경우는 MAP 삭제/수정 경로뿐이며, 그 경로는
  // 위 isMapDeleteEditDoc 분기에서 이미 return 되므로 여기 아래에는 절대 도달하지 않는다
  // (다른 모든 경로는 R 이 관문이라 parallelPresent 시점엔 R 이 항상 이미 approved 다 —
  // 그래서 여기엔 R 을 위한 행이 없다. rStep/rvStep 은 위 isMapDeleteEditDoc 분기에서만 쓰인다).

  // 경로1: P(→검토자 PV, 다중 가능)→J. 담당자 합의만으로 끝나지 않고 검토자 전원 합의까지 끝나야
  // J 가 생성되므로, 담당자 합의 후 검토자가 아직 남아 있으면 '검토자' 단계로 표시한다.
  if (pStep || pvSteps.length > 0 || jSteps.length > 0) {
    const path1PendingP = pStep?.action === 'pending' ? pStep : undefined;
    const pvPendingSteps = pvSteps.filter(s => s.action === 'pending');
    const jPendingSteps = jSteps.filter(s => s.action === 'pending');
    const path1Done = !path1PendingP && pvPendingSteps.length === 0 && jSteps.length > 0 && jPendingSteps.length === 0;
    let stageText: string; let dueDate: string | null; let pathStatus: string;
    if (path1Done) {
      // 완료 시점엔 검토중이라 가려뒀던 J 이름도 포함해 실제로 결재했던 사람 전원을 보여준다.
      stageText = namedApprovers([...(pStep ? [pStep] : []), ...pvSteps, ...jSteps]) ?? t('common.status_approved');
      dueDate = null;
      pathStatus = 'approved';
    } else if (path1PendingP) {
      stageText = buildStageText(path1PendingP, false, t);
      dueDate = path1PendingP.due_date ?? null;
      pathStatus = path1PendingP.assignee_loginid ? 'under_review' : 'unassigned';
    } else if (pvPendingSteps.length > 0) {
      // 담당자는 합의했으나 지정된 검토자가 아직 남아 있음
      const label = t('approval.stage_reviewer' as any);
      const names = pvPendingSteps.map(s => s.assignee_name).filter(Boolean);
      stageText = names.length > 0 ? `${label}(${names.join(' / ')})` : label;
      dueDate = pvPendingSteps[0]?.due_date ?? null;
      pathStatus = 'under_review';
    } else {
      // J는 검토중(claim) 방식 — 진행 중에는 담당자 이름을 노출하지 않는다(완료 후에는 위 path1Done 분기에서 표시).
      stageText = t('approval.agent_J' as any);
      dueDate = jPendingSteps[0]?.due_date ?? null;
      const jHasUnassigned = jPendingSteps.some(s => !s.assignee_loginid);
      pathStatus = jHasUnassigned ? 'unassigned' : 'under_review';
    }
    rows.push({ pathKey: 'path1', stageText, dueDate, isDone: path1Done, pathStatus });
  }

  // 경로2: O/E(→검토자 EV, 다중 가능). E 담당자 합의만으로 끝나지 않고 검토자 전원 합의까지 필요.
  if (oStep || eStep) {
    const p2MainPending = ([oStep, eStep] as (typeof oStep)[]).filter(
      (s): s is NonNullable<typeof oStep> => !!s && s.action === 'pending'
    );
    const evPendingSteps = evSteps.filter(s => s.action === 'pending');
    const done = p2MainPending.length === 0 && evPendingSteps.length === 0;
    const stageText = done
      // 완료 시점엔 검토중이라 가려뒀던 O 이름도 포함해 실제로 결재했던 사람 전원을 보여준다.
      // skip(건너뜀) 된 EV 는 판단하지 않았으므로 결재자로 표시하지 않는다.
      ? namedApprovers([...(oStep ? [oStep] : []), ...(eStep ? [eStep] : []),
                        ...evSteps.filter((s) => s.action === 'approved')]) ?? t('common.status_approved')
      : [
          ...p2MainPending.map(s => {
            const l = t(`approval.agent_${s.agent}` as any);
            // O는 J와 동일하게 검토중(claim) 방식이라 진행 중에는 담당자 이름을 노출하지 않는다.
            if (s.agent === 'O') return l;
            return s.assignee_name ? `${l}(${s.assignee_name})` : l;
          }),
          ...evPendingSteps.map(s => {
            const l = t('approval.stage_reviewer' as any);
            return s.assignee_name ? `${l}(${s.assignee_name})` : l;
          }),
        ].join(' / ');
    const dueDate = ([...p2MainPending, ...evPendingSteps]).reduce<string | null>((m, s) => {
      if (!s.due_date) return m;
      return !m || s.due_date > m ? s.due_date : m;
    }, null);
    // O·E가 같이 있고 아직 진행 중일 때만 상태점용 개별 상태를 채운다(둘 다 pending일 수 있어
    // 대표 뱃지 하나로는 "한쪽만 검토중" 같은 중간 상태가 안 드러나기 때문 — docs/APPROVAL.md §3.3).
    // E 상태점 이름: 아직 합의하지 않은 검토자(evPendingSteps)가 있으면 그 이름들(다중이면 ' / '로
    // 연결)을 보여준다 — 공이 담당자에서 검토자에게 넘어갔음을 나타낸다. 검토자가 아직 지정되지
    // 않았으면(=담당자만 선점한 단계) 담당자 이름을 그대로 보여준다.
    const eReviewerNames = evPendingSteps.map(s => s.assignee_name).filter(Boolean).join(' / ') || undefined;
    const subStages: DocSubStage[] | undefined = (!done && oStep && eStep)
      ? [
          { label: t('approval.agent_O' as any), state: oStep.action === 'approved' ? 'done' : (oStep.assignee_loginid ? 'review' : 'wait') },
          {
            label: t('approval.agent_E' as any),
            state: eStep.action !== 'approved'
              ? (eStep.assignee_loginid ? 'review' : 'wait')
              : (evPendingSteps.length > 0 ? 'review' : 'done'),
            name: evPendingSteps.length > 0 ? eReviewerNames : eStep.assignee_name,
          },
        ]
      : undefined;
    // 대표 뱃지: 배열에서 먼저 오는 항목만 보던 기존 로직 대신, O·E·EV 중 하나라도 배정돼 있으면 검토중으로 판정한다
    // (예전엔 O가 미배정이면 E가 이미 검토중이어도 뱃지가 '대기중'으로 보이는 문제가 있었음).
    // doc.status==='rejected'/'pause' 는 이 지점에 도달하기 전에 이미 위에서 early return 됐다(§3.3).
    const anyAssigned = [...p2MainPending, ...evPendingSteps].some(s => s.assignee_loginid);
    rows.push({
      pathKey: 'path2', stageText, dueDate, isDone: done,
      pathStatus: done ? 'approved' : (anyAssigned ? 'under_review' : 'unassigned'),
      subStages,
    });
  }

  // 경로3: 후결자(RA) — 미합의 후결자 이름을 표시(다른 단계와 동일한 '라벨(이름)' 형식), 완료 시 합의자 전원 표시
  if (raSteps.length > 0) {
    const raPending = raSteps.filter(s => s.action === 'pending');
    const done = raPending.length === 0;
    const label = t('approval.stage_post' as any);
    const names = raPending.map(s => s.assignee_name).filter(Boolean);
    const stageText = done
      ? namedApprovers(raSteps) ?? t('common.status_approved')
      : names.length > 0 ? `${label}(${names.join(' / ')})` : label;
    const dueDate = raPending.reduce<string | null>((m, s) => {
      if (!s.due_date) return m;
      return !m || s.due_date > m ? s.due_date : m;
    }, null);
    rows.push({
      pathKey: 'path3',
      stageText,
      dueDate,
      isDone: done,
      pathStatus: done ? 'approved' : 'under_review',
    });
  }

  return rows.length > 0 ? rows : [{
    pathKey: 'single',
    stageText: doc.status === 'approved' ? t('common.status_approved') : '-',
    dueDate: null,
    isDone: true,
    pathStatus: doc.status,
  }];
};
