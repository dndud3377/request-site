// 결재 현황 테이블 계산 헬퍼 — ApprovalPage 와 HomePage(최근 의뢰 현황)가 동일한 표를 그리도록 공유한다.
import type { TFunction } from 'i18next';
import { RequestDocument } from '../types';
import { formatDate } from './date';

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

// 최종 완료 예상일: max(path1_end, path2_end, path3_end(후결자))
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

  const candidates = [path1End, path2End, path3End].filter(Boolean) as string[];
  if (candidates.length === 0) return '-';
  return formatDate(candidates.reduce((a, b) => (a > b ? a : b)));
};

export interface DocTableRow {
  pathKey: 'single' | 'path1' | 'path2' | 'path3';
  stageText: string;
  dueDate: string | null;
  isDone: boolean;
  pathStatus: string; // 경로별 상태 (StatusBadge에 전달)
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

  // 완료된 단계들의 '라벨(이름)'을 모아 " / "로 연결. 하나도 이름이 없으면 undefined(호출부에서 기본 문구로 대체).
  const namedApprovers = (steps: { agent: string; assignee_name?: string }[]): string | undefined => {
    const parts = steps
      .filter(s => s.assignee_name)
      .map(s => `${stageLabel(s.agent, t)}(${s.assignee_name})`);
    return parts.length > 0 ? parts.join(' / ') : undefined;
  };

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
      ? namedApprovers([...(oStep ? [oStep] : []), ...(eStep ? [eStep] : []), ...evSteps]) ?? t('common.status_approved')
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
    rows.push({
      pathKey: 'path2', stageText, dueDate, isDone: done,
      pathStatus: resolvePathStatus(p2MainPending[0] ?? evPendingSteps[0], done, doc.status),
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
