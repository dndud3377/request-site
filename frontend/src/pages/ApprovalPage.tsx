import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { documentsAPI, usersAPI, userGroupsAPI, layerFilterSetsAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import StageGrid from '../components/StageGrid';
import Modal, { ConfirmModal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import PagedDetailView, { ReviewItemsPanelProps, PagedDetailViewHandle } from '../components/PagedDetailView';
import { ReviewItemsNotice } from '../components/ReviewItems';
import { canUserAgree, canUserAssign, canUserClaim, canUserUnclaim, REVIEW_AGENT_OF, ROLE_TO_AGENT } from '../components/ApprovalFlow';
import { RequestDocument, AgentType, UserRole, UserWithRole, ApprovalStepFrontend, ValidationSystemValue, UserGroup, ReviewItem, LayerFilterSet } from '../types';
import { formatDate } from '../utils/date';
import { exportAll as exportAllXlsx } from '../utils/detailExport';
import FilterManageModal from './RequestPage/components/FilterManageModal';
import { emptyDraftWords } from './RequestPage/helpers';
import {
  getDocTableRows, getFinalCompletionDate, getCurrentRound, getLastRejectionInfo,
  hasActivePendingStep, isMyDocument,
  getDocDetailFields, getMapPurposeKey, getDocSubmittedDate, MAP_PURPOSE_NA,
} from '../utils/approvalTable';
import { OPTION_LINE, OPTION_REQUEST_PURPOSE, MAP_TYPE_CLONE, MAP_TYPE_EXISTING, MAP_TYPE_DELETE_REQ } from './RequestPage/constants';
import { TOUR_APPROVAL_DOCS, TOUR_APPROVAL_MY_IDS, TOUR_APPROVAL_DETAIL_DOC, TOUR_APPROVAL_ASSIGN_DOC, TOUR_ASSIGN_MEMBERS, TOUR_REVIEW_ITEM_CANDIDATES, TOUR_PAUSE_REASON } from './approvalTourSeed';
import StepGuideTour, { StepGuideGroup } from '../components/StepGuideTour';

// "그룹 지정" 하이라이트 가이드 투어 시연용 — 실제 목록(allDocs/docs)은 건드리지 않고
// 상세 모달(selected)만 이 가짜 임시저장 문서로 띄워서 공유 버튼을 보여준다.
const makeShareGuideDemoDoc = (loginid: string): RequestDocument => ({
  id: -1,
  title: '(가이드 예시) 임시저장 의뢰서',
  requester_name: '나',
  requester_email: '',
  requester_department: '',
  product_name: 'PART_1234',
  reference_materials: '',
  additional_notes: '',
  status: 'draft',
  production_date: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  submitted_at: null,
  requester_loginid: loginid,
  can_edit: true,
  shared_group: null,
  shared_group_name: null,
});

// 전체 가이드 상세 모달에서 특정 페이지로 이동하기 위한 페이지 인덱스
// (MASTER 역할 기준 페이지 순서: 0 상세 · 1 MAP · 2 JOB · 3 OVL · 4 BB · 5 결재 경로)
const TOUR_PAGE_IDX: Record<string, number> = { jayer: 2, route: 5 };

const AGENT_TO_ROLE: Record<string, string> = {
  R: 'TE_R',
  P: 'TE_P',
  J: 'TE_J',
  O: 'TE_O',
  E: 'TE_E',
};

// MAP 목적 필터 드롭다운 옵션 — StepMap 버튼 값(NEW/CLONE/EXISTING) + MAP 삭제 전용 값(삭제) +
// ADI CD 변경처럼 map_type 자체가 없는 문서를 가리키는 MAP_PURPOSE_NA.
const MAP_PURPOSE_OPTIONS = ['NEW', MAP_TYPE_CLONE, MAP_TYPE_EXISTING, MAP_TYPE_DELETE_REQ, MAP_PURPOSE_NA];

type ColSortKey = 'line' | 'purpose' | 'mapType' | 'submitted';
type FilterDropdownKey = 'line' | 'purpose' | 'map' | 'date';

// 결재 현황 목록 페이지네이션 — 페이지당 표시 건수
const APPROVAL_LIST_PAGE_SIZE = 10;
// 숫자 페이지 버튼 표시 시 현재 페이지 앞뒤로 보여줄 개수(그 밖은 '…'로 생략)
const APPROVAL_PAGE_WINDOW = 2;

// ===== Utils =====
// 결재 현황 테이블 계산 헬퍼는 utils/approvalTable 로 이동(HomePage 최근 의뢰 현황과 공유).

/** 페이지네이션 숫자 버튼 목록. 1·마지막 페이지는 항상 포함하고, 현재 페이지 앞뒤로
 * APPROVAL_PAGE_WINDOW 개만 보여준 뒤 나머지 구간은 'ellipsis' 로 접는다. */
const buildPageNumbers = (current: number, total: number): (number | 'ellipsis')[] => {
  const pages = new Set<number>([1, total]);
  for (let p = current - APPROVAL_PAGE_WINDOW; p <= current + APPROVAL_PAGE_WINDOW; p++) {
    if (p >= 1 && p <= total) pages.add(p);
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: (number | 'ellipsis')[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) result.push('ellipsis');
    result.push(p);
    prev = p;
  }
  return result;
};

// 중단 요청 '확인' 가능 여부(프론트 가드): MASTER / 담당자 본인 / (미배정 시) 같은 팀
// 철회 요청 확인·거부도 같은 규칙을 쓴다(서버 `_can_confirm_pause` 를 두 액션이 공유).
const canConfirmPauseStep = (
  user: { role?: UserRole | string | null; username?: string },
  step: ApprovalStepFrontend,
): boolean => {
  if (user.role === 'MASTER') return true;
  const loginid = user.username;
  if (step.assignee_loginid) return !!loginid && step.assignee_loginid === loginid;
  const agent = user.role ? ROLE_TO_AGENT[user.role as UserRole] : undefined;
  return agent === step.agent;
};

// ===== (ApprovalFlow, PagedDetailView are imported from components/) =====

// ===== Main Page =====

interface FilterTab {
  key: string;
  label: string;
}

export default function ApprovalPage(): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const addToast = useToast();
  const { currentUser } = useAuth();

  // 전체 가이드 투어 모드: /approval?embed=tour — 샘플 데이터로 결재 현황을 시연한다.
  const isTourMode = new URLSearchParams(location.search).get('embed') === 'tour';
  // 투어에서 제목을 '실제로 클릭'하는 모습을 보여주기 위한 가짜 커서
  const [tourCursor, setTourCursor] = useState<{ x: number; y: number } | null>(null);
  const [tourClicking, setTourClicking] = useState(false);

  const [docs, setDocs] = useState<RequestDocument[]>([]);
  const [allDocs, setAllDocs] = useState<RequestDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // 초기 탭은 `?filter=my` 로 지정할 수 있다 — 홈 '나의 의뢰 현황'의 '전체 보기' 가 이 경로로 온다.
  // 쿼리 파라미터로 받으면 새로고침·링크 공유에도 탭이 유지된다.
  const [filter, setFilter] = useState(
    () => new URLSearchParams(location.search).get('filter') ?? ''
  );
  const [search, setSearch] = useState('');
  // 양산일 3단 정렬(오름차순→내림차순→원래 상태). 필터 탭 전환 시 자동 해제.
  const [prodDateSort, setProdDateSort] = useState<'asc' | 'desc' | null>(null);
  // 라인/목적/MAP 목적/요청일 컬럼 헤더 클릭 정렬. 양산일 정렬과는 배타적으로 동작한다(하나만 활성).
  const [colSort, setColSort] = useState<{ key: ColSortKey; dir: 'asc' | 'desc' } | null>(null);
  // 필터 바(라인/목적/MAP 목적 체크박스, 요청일 기간). 필터 탭 전환 시 정렬과 함께 자동 해제.
  const [lineFilter, setLineFilter] = useState<Set<string>>(new Set());
  const [purposeFilter, setPurposeFilter] = useState<Set<string>>(new Set());
  const [mapFilter, setMapFilter] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [openFilterDropdown, setOpenFilterDropdown] = useState<FilterDropdownKey | null>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  // 전체 export(제목 옆 버튼) — 상세 정보/MAP 정보 탭을 화면 그대로 캡처하는 핸들.
  const pagedDetailViewRef = useRef<PagedDetailViewHandle>(null);
  useEffect(() => {
    setProdDateSort(null);
    setColSort(null);
    setLineFilter(new Set());
    setPurposeFilter(new Set());
    setMapFilter(new Set());
    setDateFrom('');
    setDateTo('');
  }, [filter]);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterBarRef.current && !filterBarRef.current.contains(e.target as Node)) {
        setOpenFilterDropdown(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  // 목록 페이지네이션 — 필터 탭·검색어·컬럼 필터가 바뀌면 항상 1페이지로 돌아간다(검색 결과가
  // 몇 페이지 뒤에 있든 즉시 보이도록).
  const [listPage, setListPage] = useState(1);
  useEffect(() => { setListPage(1); }, [filter, search, lineFilter, purposeFilter, mapFilter, dateFrom, dateTo]);
  const [selected, setSelected] = useState<RequestDocument | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);

  // 결재 상세페이지 J/O-layer 공유 필터(팀 전체가 관리하는 목록 — 의뢰서 작성 화면의
  // 개인별 필터와는 별개). TE_J/TE_O/MASTER 로그인 시에만 조회해 두면 된다.
  const [jayerLayerFilterSets, setJayerLayerFilterSets] = useState<LayerFilterSet[]>([]);
  const [oayerLayerFilterSets, setOayerLayerFilterSets] = useState<LayerFilterSet[]>([]);
  const [jayerFilterManageOpen, setJayerFilterManageOpen] = useState(false);
  const [oayerFilterManageOpen, setOayerFilterManageOpen] = useState(false);
  const [jayerFilterNewDraft, setJayerFilterNewDraft] = useState<{ label: string; words: { sp: string[]; sd: string[]; pp: string[] } }>({ label: '', words: emptyDraftWords() });
  const [oayerFilterNewDraft, setOayerFilterNewDraft] = useState<{ label: string; words: { sp: string[]; sd: string[]; pp: string[] } }>({ label: '', words: emptyDraftWords() });
  // 팀 전체가 공유하는 필터라 삭제는(개별/전체 모두) 확인 후 진행한다.
  const [layerFilterDeleteConfirm, setLayerFilterDeleteConfirm] = useState<{ table: 'J' | 'O'; id: number; label: string } | null>(null);
  const [layerFilterAllDeleteConfirm, setLayerFilterAllDeleteConfirm] = useState<'J' | 'O' | null>(null);

  useEffect(() => {
    if (currentUser.role === 'TE_J' || currentUser.role === 'MASTER') {
      layerFilterSetsAPI.list('J').then(setJayerLayerFilterSets).catch(() => {});
    }
    if (currentUser.role === 'TE_O' || currentUser.role === 'MASTER') {
      layerFilterSetsAPI.list('O').then(setOayerLayerFilterSets).catch(() => {});
    }
  }, [currentUser.role]);

  // 합의/반려 comment 모달
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  // isPeer = PL 검토 단계(peer-approve/reject), isSalesAgreer = 영업/기술지원 합의자(sales-agree/reject).
  // 둘 다 아니면 일반 단계(approve-step/reject-step).
  const [pendingAction, setPendingAction] = useState<{ type: 'agree' | 'reject'; agent: AgentType; isPeer?: boolean; isSalesAgreer?: boolean } | null>(null);
  const [commentInput, setCommentInput] = useState('');

  // 중단 요청 사유 입력 모달
  const [pauseReasonModalOpen, setPauseReasonModalOpen] = useState(false);
  const [pauseReasonInput, setPauseReasonInput] = useState('');

  // 지정하기 UI (모달 footer)
  const [assigningOpen, setAssigningOpen] = useState(false);
  const [assigningUserId, setAssigningUserId] = useState('');
  const [assigningReviewerId, setAssigningReviewerId] = useState(''); // R단계 검토자('' = 검토자 없음)

  // 후결자 관리 UI (작성자/MASTER — 고정 후결자 제외, 칩 목록 + 검색 추가)
  const [paAddOpen, setPaAddOpen] = useState(false);
  const [paSearchQuery, setPaSearchQuery] = useState('');
  const [paCandidates, setPaCandidates] = useState<UserWithRole[]>([]);
  const [assignDropdownOpen, setAssignDropdownOpen] = useState(false);
  const [assignReviewerDropdownOpen, setAssignReviewerDropdownOpen] = useState(false); // R단계 검토자 드롭다운
  const [teamMembers, setTeamMembers] = useState<UserWithRole[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // 지정자 변경 UI (모달 footer)
  const [changingDesigneeOpen, setChangingDesigneeOpen] = useState(false);
  const [changingDesigneeUserId, setChangingDesigneeUserId] = useState('');
  const [changingDesigneeQuery, setChangingDesigneeQuery] = useState('');
  const [changingDesigneeDropdownOpen, setChangingDesigneeDropdownOpen] = useState(false);
  const changingDesigneeRef = React.useRef<HTMLDivElement>(null);

  // 검토자 선택 UI (P/E 담당자 본인 — 합의 버튼과 함께 노출, R 담당자지정 드롭다운과 동일한 스타일)
  // 드롭다운에서 이름을 클릭하면 바로 추가되고(별도 '추가'/'확인' 버튼 없음), '합의' 클릭 시 그 순간
  // 선택돼 있는 검토자 지정 + 담당자 합의가 한 번의 요청으로 함께 처리된다.
  const [reviewerCandidates, setReviewerCandidates] = useState<UserWithRole[]>([]);
  // 검토 항목의 검토자 후보 (J 권한자 = TE_J + MASTER). 상세 모달을 열 때 1회 적재.
  const [reviewItemCandidates, setReviewItemCandidates] = useState<UserWithRole[]>([]);
  const [reviewerSelectedIds, setReviewerSelectedIds] = useState<string[]>([]);
  const [reviewerDropdownOpen, setReviewerDropdownOpen] = useState(false);

  const handleLoadTeamMembers = async (agent: AgentType): Promise<UserWithRole[]> => {
    // 투어: 실제 API 대신 샘플 팀 인원을 반환(실제 지정 UI와 동일하게 select 채움)
    if (isTourMode) return TOUR_ASSIGN_MEMBERS;
    const role = AGENT_TO_ROLE[agent];
    if (!role) return [];
    const res = await usersAPI.list(role);
    return res.data;
  };

  const applyClientFilter = useCallback((all: RequestDocument[]): RequestDocument[] => {
    if (isTourMode) {
      if (filter === 'my') return all.filter(d => TOUR_APPROVAL_MY_IDS.has(d.id));
      return all;
    }
    if (filter === 'draft') return all.filter(d => d.status === 'draft');
    if (filter === 'rejected') return all.filter(d => d.status === 'rejected');
    if (filter === 'pause') return all.filter(d => d.status === 'pause');
    // MY 판정은 홈 '나의 의뢰 현황'과 공유한다(utils/approvalTable.isMyDocument).
    if (filter === 'my') return all.filter((d) => isMyDocument(d, currentUser));
    if (filter.startsWith('agent_')) {
      const agent = filter.replace('agent_', '') as AgentType;
      return all.filter((d) => hasActivePendingStep(d, (s) => s.agent === agent));
    }
    return all;
  }, [filter, currentUser, isTourMode]);

  const getTabCount = useCallback((key: string, base: RequestDocument[]): number => {
    if (isTourMode) {
      if (key === '') return base.length;
      if (key === 'my') return base.filter(d => TOUR_APPROVAL_MY_IDS.has(d.id)).length;
      return 0;
    }
    if (key === '') return base.length;
    if (key === 'draft') return base.filter(d => d.status === 'draft').length;
    if (key === 'rejected') return base.filter(d => d.status === 'rejected').length;
    if (key === 'pause') return base.filter(d => d.status === 'pause').length;
    if (key === 'my') return base.filter(d => isMyDocument(d, currentUser)).length;
    if (key.startsWith('agent_')) {
      const agent = key.replace('agent_', '') as AgentType;
      return base.filter(d => hasActivePendingStep(d, s => s.agent === agent)).length;
    }
    return 0;
  }, [currentUser, isTourMode]);

  // fetchDocs 는 filter/search 가 바뀔 때마다 재실행되는데, 응답이 요청 순서와
  // 다르게 도착할 수 있다(느린 "전체 목록" 요청이 빠른 "검색" 요청보다 늦게 도착 등).
  // 시퀀스 토큰으로 "가장 최근에 보낸 요청"의 응답만 반영하고 나머지는 버린다.
  const fetchSeqRef = useRef(0);

  const fetchDocs = useCallback(() => {
    if (isTourMode) {
      setAllDocs(TOUR_APPROVAL_DOCS);
      setDocs(applyClientFilter(TOUR_APPROVAL_DOCS));
      setError(false);
      setLoading(false);
      return;
    }
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(false);
    const params: Record<string, string> = {};
    if (search) params.search = search;
    documentsAPI
      .list(params)
      .then((r) => {
        if (seq !== fetchSeqRef.current) return; // 이미 더 최신 요청이 나간 뒤 도착한 응답 — 무시
        const data = r.data;
        let all: RequestDocument[] = Array.isArray(data) ? data : (data as any).results ?? [];
        // 결재 현황: approved 제외
        all = all.filter((d) => d.status !== 'approved');
        setAllDocs(all);
        setDocs(applyClientFilter(all));
      })
      .catch(() => {
        if (seq !== fetchSeqRef.current) return;
        setError(true); setAllDocs([]); setDocs([]);
      })
      .finally(() => {
        if (seq !== fetchSeqRef.current) return;
        setLoading(false);
      });
  }, [filter, search, applyClientFilter]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  // 메일 딥링크(?id=) — 해당 문서를 직접 조회해 상세 모달을 열고, 배경 목록도 그
  // 문서 제목으로 자동 검색되게 한다(필터 탭은 검색과 충돌하지 않도록 전체로 리셋).
  useEffect(() => {
    if (isTourMode) return;
    const id = new URLSearchParams(location.search).get('id');
    if (!id) return;
    documentsAPI.get(Number(id))
      .then((res) => {
        setSelected(res.data);
        setPageIdx(0);
        setModalOpen(true);
        setFilter('');
        setSearch(res.data.title);
      })
      .catch(() => { /* 존재하지 않거나 접근 불가한 문서 — 조용히 무시 */ });
  }, [location.search, isTourMode]);

  // 전체 가이드(투어) 명령 수신: MY 필터 → 제목 클릭(커서)으로 상세 열기 → J-ayer export → 결재 경로 탭
  useEffect(() => {
    if (!isTourMode) return;
    let activeTok: { cancelled: boolean } | null = null;
    let paused = false;
    const rawSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    // 일시정지를 반영하는 sleep — paused 동안 멈췄다가 재생 시 이어서 진행한다.
    const sleep = async (ms: number) => {
      let elapsed = 0;
      while (elapsed < ms) {
        if (paused) { await rawSleep(60); continue; }
        await rawSleep(60);
        elapsed += 60;
      }
    };

    // 커서를 의뢰 제목으로 이동(스크롤로 보이게) → 눌러서 상세 모달을 연다.
    const runOpenDetail = async (tok: { cancelled: boolean }) => {
      setTourCursor(null);
      setTourClicking(false);
      // 이전에 열린 모달(예: 지정하기 시연)이 있으면 닫고 목록으로 돌아간다.
      setModalOpen(false);
      setAssigningOpen(false);
      await sleep(400); if (tok.cancelled) return;
      const el = document.querySelector('[data-tour="approval-doc-title"]') as HTMLElement | null;
      if (el) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); await sleep(320); if (tok.cancelled) return; }
      const r = el?.getBoundingClientRect();
      if (r) setTourCursor({ x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 });
      await sleep(650); if (tok.cancelled) return;
      setTourClicking(true);
      el?.classList.add('tour-pressed');
      await sleep(300); if (tok.cancelled) return;
      setTourClicking(false);
      el?.classList.remove('tour-pressed');
      setSelected(TOUR_APPROVAL_DETAIL_DOC);
      setPageIdx(0);
      setModalOpen(true);
      await sleep(300);
      setTourCursor(null);
    };

    // 커서를 선택자 요소로 이동시키고 눌림 애니메이션을 재생하는 공용 헬퍼
    const cursorPress = async (selector: string, tok: { cancelled: boolean }): Promise<HTMLElement | null> => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); await sleep(320); if (tok.cancelled) return null; }
      const r = el?.getBoundingClientRect();
      if (r) setTourCursor({ x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 });
      await sleep(550); if (tok.cancelled) return null;
      setTourClicking(true);
      el?.classList.add('tour-pressed');
      await sleep(300); if (tok.cancelled) return null;
      setTourClicking(false);
      el?.classList.remove('tour-pressed');
      return el;
    };

    // 문서 C(지정 대기) 상세를 열고 → 실제 지정 UI(드롭다운 버튼→항목→확인)로 담당자를 배정하는 모습까지 시연한다.
    // 각 단계는 실제 DOM 클릭(el.click())을 호출해 운영과 동일한 onClick 동작을 그대로 탄다.
    const runOpenAssign = async (tok: { cancelled: boolean }) => {
      setTourCursor(null);
      setTourClicking(false);
      setModalOpen(false);
      setAssigningOpen(false);
      setAssigningUserId('');
      setAssignDropdownOpen(false);
      await sleep(300); if (tok.cancelled) return;
      setSelected(TOUR_APPROVAL_ASSIGN_DOC);
      setPageIdx(0);
      setModalOpen(true);
      await sleep(700); if (tok.cancelled) return;
      // ① '지정하기' 클릭 → 실제 onClick(후보 로드 + 지정 UI 노출)
      const assignBtn = await cursorPress('[data-tour="assign-btn"]', tok); if (tok.cancelled) return;
      assignBtn?.click();
      await sleep(700); if (tok.cancelled) return;
      // ② 드롭다운 버튼 클릭 → 후보 목록 펼침
      const ddBtn = await cursorPress('[data-tour="assign-select"]', tok); if (tok.cancelled) return;
      ddBtn?.click();
      await sleep(600); if (tok.cancelled) return;
      // ③ 후보 항목(첫 번째 인원) 클릭 → 선택
      const opt = await cursorPress('[data-tour="assign-option"]', tok); if (tok.cancelled) return;
      opt?.click();
      await sleep(600); if (tok.cancelled) return;
      // ④ '확인' 클릭 → 해당 단계에 담당자 배정(투어 로컬 반영)
      const ok = await cursorPress('[data-tour="assign-confirm"]', tok); if (tok.cancelled) return;
      ok?.click();
      await sleep(300);
      setTourCursor(null);
    };

    // 상세(문서 A) J-ayer 페이지의 '이력 확인' 버튼을 실제로 눌러 변경 전/후 모달을 연다.
    const runOpenRowDiff = async (tok: { cancelled: boolean }) => {
      await sleep(300); if (tok.cancelled) return;
      const btn = document.querySelector('[data-tour="jayer-hist-btn"]') as HTMLElement | null;
      btn?.scrollIntoView({ block: 'center', inline: 'nearest' });
      await sleep(280); if (tok.cancelled) return;
      btn?.click();
    };

    // 문서 A 상세(다시 열지 않았다면 열고)에서 '중단 요청'을 실제로 눌러 사유를 입력·제출한다.
    // 되감기(seek)로 이 phase에 바로 진입해도 항상 같은 상태에서 시작하도록 문서 A의
    // 중단 요청 상태를 매번 초기화한다.
    const runOpenPause = async (tok: { cancelled: boolean }) => {
      setTourCursor(null);
      setTourClicking(false);
      setPauseReasonModalOpen(false);
      setPauseReasonInput('');
      // 이전 phase(이력 비교 모달 등)에서 열려 있던 상세 모달을 완전히 닫았다가 다시 열어,
      // PagedDetailView 내부 상태(이력 비교 모달 등)까지 항상 깨끗하게 초기화한다.
      setModalOpen(false);
      await sleep(300); if (tok.cancelled) return;
      const resetPause = (d: RequestDocument): RequestDocument =>
        d.id !== TOUR_APPROVAL_DETAIL_DOC.id ? d : { ...d, can_request_pause: true, pause_request: null, status: 'under_review' };
      setAllDocs((prev) => prev.map(resetPause));
      setDocs((prev) => prev.map(resetPause));
      setSelected(resetPause(TOUR_APPROVAL_DETAIL_DOC));
      setPageIdx(0);
      setModalOpen(true);
      await sleep(500); if (tok.cancelled) return;
      // ① '중단 요청' 클릭 → 실제 onClick(사유 입력 모달 오픈)
      const openBtn = await cursorPress('[data-tour="pause-request-btn"]', tok); if (tok.cancelled) return;
      openBtn?.click();
      await sleep(500); if (tok.cancelled) return;
      // ② 사유 타이핑 연출
      for (let i = 0; i <= TOUR_PAUSE_REASON.length; i += 1) {
        if (tok.cancelled) return;
        setPauseReasonInput(TOUR_PAUSE_REASON.slice(0, i));
        await sleep(45);
      }
      await sleep(450); if (tok.cancelled) return;
      // ③ 제출 → 실제 onClick(submitRequestPause, 투어에서는 로컬 반영)
      const submitBtn = await cursorPress('[data-tour="pause-request-submit"]', tok); if (tok.cancelled) return;
      submitBtn?.click();
      await sleep(300);
      setTourCursor(null);
    };

    // 확인 대상 담당자 중 1명이 '중단 확인'을 누르는 모습을 시연한다(병렬 단계는 전원 확인 전까지 대기 유지).
    const runConfirmPause = async (tok: { cancelled: boolean }) => {
      await sleep(300); if (tok.cancelled) return;
      const btn = await cursorPress('[data-tour="pause-confirm-btn"]', tok); if (tok.cancelled) return;
      btn?.click();
      await sleep(300);
      setTourCursor(null);
    };

    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.type !== 'guide-tour-cmd') return;
      if (d.cmd === 'pause') { paused = true; return; }
      if (d.cmd === 'resume') { paused = false; return; }
      if (activeTok) activeTok.cancelled = true;
      const tok = { cancelled: false };
      activeTok = tok;
      switch (d.cmd) {
        case 'tour-reset':
          setModalOpen(false);
          setFilter('');
          setTourCursor(null);
          setTourClicking(false);
          break;
        case 'my-filter':
          setFilter('my');
          break;
        case 'all-filter':
          setFilter('');
          break;
        case 'open-detail':
          runOpenDetail(tok);
          break;
        case 'open-assign':
          runOpenAssign(tok);
          break;
        case 'open-rowdiff':
          runOpenRowDiff(tok);
          break;
        case 'open-pause':
          runOpenPause(tok);
          break;
        case 'confirm-pause':
          runConfirmPause(tok);
          break;
        case 'page-jayer':
          setPageIdx(TOUR_PAGE_IDX.jayer);
          // 검토 항목 서브탭을 보고 있었다면 표로 되돌린다(다음 시연이 표 위 버튼을 쓴다).
          (async () => {
            await sleep(260); if (tok.cancelled) return;
            (document.querySelector('[data-tour="ri-subtab-table"]') as HTMLElement | null)?.click();
          })();
          break;
        // JOB 탭의 '검토 항목' 서브탭을 커서로 눌러 연다(서브탭 상태는 PagedDetailView 안에 있다).
        case 'page-review-items':
          setPageIdx(TOUR_PAGE_IDX.jayer);
          (async () => {
            await sleep(400); if (tok.cancelled) return;
            const el = await cursorPress('[data-tour="ri-subtab"]', tok); if (tok.cancelled) return;
            el?.click();
            await sleep(300);
            setTourCursor(null);
          })();
          break;
        case 'page-route':
          setPageIdx(TOUR_PAGE_IDX.route);
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      if (activeTok) activeTok.cancelled = true;
    };
  }, [isTourMode]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (changingDesigneeRef.current && !changingDesigneeRef.current.contains(e.target as Node)) {
        setChangingDesigneeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const tabBaseLabels: { key: string; baseLabel: string }[] = [
    { key: '', baseLabel: t('approval.filter_all') },
    { key: 'my', baseLabel: t('approval.filter_my') },
    { key: 'agent_R', baseLabel: t('approval.filter_agent_R') },
    { key: 'agent_P', baseLabel: t('approval.filter_agent_P') },
    { key: 'agent_J', baseLabel: t('approval.filter_agent_J') },
    { key: 'agent_O', baseLabel: t('approval.filter_agent_O') },
    { key: 'agent_E', baseLabel: t('approval.filter_agent_E') },
    { key: 'pause', baseLabel: t('approval.filter_pause') },
    { key: 'draft', baseLabel: t('approval.filter_draft') },
    { key: 'rejected', baseLabel: t('approval.filter_rejected') },
  ];
  const filterTabs: FilterTab[] = tabBaseLabels.map(({ key, baseLabel }) => {
    const count = getTabCount(key, allDocs);
    return { key, label: count > 0 ? `${baseLabel}(${count})` : baseLabel };
  });

  const toggleProdDateSort = () => {
    setColSort(null);
    setProdDateSort((prev) => (prev === null ? 'asc' : prev === 'asc' ? 'desc' : null));
  };

  // 라인/목적/MAP 목적/요청일 헤더 클릭 정렬. 양산일 정렬을 끄고 3단으로 순환한다(오름차순→내림차순→해제).
  const toggleColSort = (key: ColSortKey) => {
    setProdDateSort(null);
    setColSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  };

  const colSortIndicator = (key: ColSortKey) => {
    if (colSort?.key !== key) return <span style={{ color: 'var(--text-muted)' }}> ⇅</span>;
    return colSort.dir === 'asc' ? ' ▲' : ' ▼';
  };

  // 필터 바: 라인/목적/MAP 목적 체크박스 + 요청일 기간. docs(검색·탭 필터 적용 후)에 추가로 적용한다.
  const filteredDocs = useMemo(() => {
    if (lineFilter.size === 0 && purposeFilter.size === 0 && mapFilter.size === 0 && !dateFrom && !dateTo) {
      return docs;
    }
    return docs.filter((d) => {
      const detail = getDocDetailFields(d);
      if (lineFilter.size > 0 && !lineFilter.has(detail.line)) return false;
      if (purposeFilter.size > 0 && !purposeFilter.has(detail.purpose)) return false;
      if (mapFilter.size > 0 && !mapFilter.has(getMapPurposeKey(detail))) return false;
      const submitted = getDocSubmittedDate(d).slice(0, 10);
      if (dateFrom && (!submitted || submitted < dateFrom)) return false;
      if (dateTo && (!submitted || submitted > dateTo)) return false;
      return true;
    });
  }, [docs, lineFilter, purposeFilter, mapFilter, dateFrom, dateTo]);

  // 목록 정렬: 컬럼 헤더 정렬 켜짐 > 양산일 정렬 켜짐 > 단계별 필터(진입 순서) > 기본(상신일 오래된 순)
  const sortedDocs = useMemo(() => {
    const list = [...filteredDocs];
    if (colSort) {
      const { key, dir } = colSort;
      const sortValue = (d: RequestDocument): string => {
        if (key === 'submitted') return getDocSubmittedDate(d);
        const detail = getDocDetailFields(d);
        if (key === 'line') return detail.line;
        if (key === 'purpose') return detail.purpose;
        return getMapPurposeKey(detail);
      };
      list.sort((a, b) => {
        const cmp = sortValue(a).localeCompare(sortValue(b), 'ko');
        return dir === 'asc' ? cmp : -cmp;
      });
      return list;
    }
    if (prodDateSort) {
      const withDate = list.filter((d) => !!d.production_date);
      const withoutDate = list.filter((d) => !d.production_date);
      withDate.sort((a, b) => {
        const cmp = (a.production_date as string).localeCompare(b.production_date as string);
        return prodDateSort === 'asc' ? cmp : -cmp;
      });
      return [...withDate, ...withoutDate]; // 미입력은 방향 무관 항상 맨 아래
    }
    if (filter.startsWith('agent_')) {
      const agent = filter.replace('agent_', '');
      const stepEnteredAt = (d: RequestDocument): string => {
        const round = getCurrentRound(d);
        const step = (d.approval_steps ?? []).find(
          (s) => s.agent === agent && s.action === 'pending' && (s.round ?? 1) === round
        );
        return step?.created_at ?? '';
      };
      list.sort((a, b) => stepEnteredAt(a).localeCompare(stepEnteredAt(b)));
      return list;
    }
    const baseDate = (d: RequestDocument): string => d.submitted_at ?? d.created_at ?? '';
    list.sort((a, b) => baseDate(a).localeCompare(baseDate(b)));
    return list;
  }, [filteredDocs, colSort, prodDateSort, filter]);

  const totalListPages = Math.max(1, Math.ceil(sortedDocs.length / APPROVAL_LIST_PAGE_SIZE));
  const pagedDocs = useMemo(
    () => sortedDocs.slice((listPage - 1) * APPROVAL_LIST_PAGE_SIZE, listPage * APPROVAL_LIST_PAGE_SIZE),
    [sortedDocs, listPage],
  );
  // 결재 처리 등으로 목록이 줄어 지금 보던 페이지가 사라지면 마지막 페이지로 보정한다.
  useEffect(() => {
    if (listPage > totalListPages) setListPage(totalListPages);
  }, [listPage, totalListPages]);

  const openDetail = async (doc: RequestDocument) => {
    if (isTourMode) {
      setSelected(doc);
    } else {
      try {
        const detailResult = await documentsAPI.get(doc.id);
        setSelected(detailResult.data);
      } catch {
        setSelected(doc);
      }
    }
    setPageIdx(0);
    setAssigningOpen(false);
    setAssigningUserId('');
    setTeamMembers([]);
    setChangingDesigneeOpen(false);
    setChangingDesigneeUserId('');
    setReviewerSelectedIds([]);
    setReviewerCandidates([]);
    setReviewerDropdownOpen(false);
    setPaAddOpen(false);
    setPaSearchQuery('');
    setPaCandidates([]);
    // 검토 항목 검토자 후보는 J 권한자에게만 필요하다.
    if (!isTourMode && (currentUser.role === 'TE_J' || currentUser.role === 'MASTER')) {
      try {
        const [teJ, masters] = await Promise.all([usersAPI.list('TE_J'), usersAPI.list('MASTER')]);
        setReviewItemCandidates([...teJ.data, ...masters.data]);
      } catch {
        setReviewItemCandidates([]);
      }
    } else {
      setReviewItemCandidates([]);
    }
    setModalOpen(true);
  };

  /**
   * Validation System 수정 창.
   * 상신자 본인(또는 MASTER)이고, 진행 중이며, MASK(E) 검토가 끝나기 전까지 열려 있다.
   * 백엔드 _stage_reviewers_complete 와 같은 규칙 — E 담당자 합의 + EV 중 1명 합의로 닫힌다.
   */
  const canEditValidationSystem = (doc: RequestDocument | null): boolean => {
    if (!doc || isTourMode) return false;
    if (doc.status !== 'under_review' && doc.status !== 'pause') return false;
    const isOwner = currentUser.role === 'MASTER' || doc.requester_loginid === currentUser.username;
    if (!isOwner) return false;
    const steps = doc.approval_steps ?? [];
    const maxRound = steps.reduce((m, st) => Math.max(m, st.round), 1);
    const eStep = steps.find((st) => st.agent === 'E' && st.round === maxRound);
    if (!eStep || eStep.action !== 'approved') return true;
    const evSteps = steps.filter((st) => st.agent === 'EV' && st.round === maxRound);
    // EV 는 1명만 합의해도 MASK 검증이 끝난다(OR) — 백엔드 _stage_reviewers_complete 와 같은 규칙.
    // EV 가 하나도 없으면 백엔드는 '담당자 합의만으로 완료'(하위호환)로 보므로 창도 닫혀야 한다.
    if (evSteps.length === 0) return false;
    return evSteps.every((st) => st.action !== 'approved');
  };

  /**
   * 결재 상세페이지 J/O-layer 공유 필터 사용 가능 여부.
   * table='J' 는 TE_J/MASTER, table='O' 는 TE_O/MASTER. 문서가 under_review/pause 이고
   * 해당 단계(J 또는 O)가 이번 회차에 아직 합의되지 않았을 때만 — 백엔드 apply_layer_filter 와 같은 규칙.
   */
  const canUseLayerFilter = (doc: RequestDocument | null, table: 'J' | 'O'): boolean => {
    if (!doc || isTourMode) return false;
    const allowedRole = table === 'J' ? 'TE_J' : 'TE_O';
    if (currentUser.role !== 'MASTER' && currentUser.role !== allowedRole) return false;
    if (doc.status !== 'under_review' && doc.status !== 'pause') return false;
    const round = getCurrentRound(doc);
    const step = (doc.approval_steps ?? []).find((s) => s.agent === table && (s.round ?? 1) === round);
    return !step || step.action !== 'approved';
  };

  const handleApplyLayerFilter = async (table: 'J' | 'O', filterId: number) => {
    if (!selected) return;
    try {
      const { data } = await documentsAPI.applyLayerFilter(selected.id, table, filterId);
      addToast(data.message, data.matched_count > 0 ? 'success' : 'info');
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    }
  };

  const handleValidationSystemChange = async (value: ValidationSystemValue) => {
    if (!selected) return;
    try {
      await documentsAPI.updateValidationSystem(selected.id, value);
      addToast(t('approval.validation_system_updated'), 'success');
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    }
  };

  // ===== J-ayer 검토 항목 =====

  /** 현재 회차의 J 단계 (없으면 undefined) */
  const currentJStep = (doc: RequestDocument): ApprovalStepFrontend | undefined => {
    const round = getCurrentRound(doc);
    return (doc.approval_steps ?? []).find((s) => s.agent === 'J' && (s.round ?? 1) === round);
  };

  /**
   * 검토 항목 패널 props. 백엔드 review_items.can_edit_items / can_confirm_items 와 같은 규칙이다.
   * 반환값이 undefined 면 서브탭 자체가 뜨지 않는다(J 권한이 없거나 J 단계가 없는 문서).
   */
  const buildReviewItemsProps = (doc: RequestDocument | null): ReviewItemsPanelProps | undefined => {
    if (!doc) return undefined;
    // 전체 가이드: 시드 항목을 읽기 전용으로 보여준다(J 단계가 아직 미선점이라 실제 화면과 같은 잠금 안내).
    if (isTourMode) {
      const noop = (): void => undefined;
      return {
        items: doc.review_items ?? [],
        canEdit: false,
        canConfirm: false,
        currentLoginid: currentUser.username,
        candidates: TOUR_REVIEW_ITEM_CANDIDATES,
        notice: 'unclaimed',
        claimerName: '',
        onAdd: noop,
        onRename: noop,
        onDelete: noop,
        onAddReviewer: noop,
        onRemoveReviewer: noop,
        onConfirm: noop,
      };
    }
    const isJ = currentUser.role === 'TE_J' || currentUser.role === 'MASTER';
    if (!isJ) return undefined;
    const items = doc.review_items ?? [];
    const jStep = currentJStep(doc);
    if (!jStep && items.length === 0) return undefined;

    const inProgress = doc.status === 'under_review' || doc.status === 'pause';
    const stageOpen = inProgress && !!jStep && jStep.action === 'pending' && !!jStep.assignee_loginid;

    let notice: ReviewItemsNotice;
    if (doc.status === 'rejected') notice = 'rejected';
    else if (jStep && jStep.action !== 'pending') notice = 'approved';
    else if (!jStep || !jStep.assignee_loginid) notice = 'unclaimed';
    else notice = 'edit';

    return {
      items,
      canEdit: stageOpen,
      canConfirm: stageOpen,
      currentLoginid: currentUser.username,
      candidates: reviewItemCandidates,
      notice,
      claimerName: jStep?.assignee_name ?? '',
      onAdd: (title) => runReviewItemAction(() => documentsAPI.addReviewItem(doc.id, title)),
      onRename: (itemId, title) => runReviewItemAction(() => documentsAPI.renameReviewItem(doc.id, itemId, title)),
      onDelete: (itemId) => {
        if (!window.confirm(t('request.ri_delete_confirm'))) return;
        runReviewItemAction(() => documentsAPI.deleteReviewItem(doc.id, itemId));
      },
      onAddReviewer: (itemId, loginid) => runReviewItemAction(() => documentsAPI.addReviewItemReviewer(doc.id, itemId, loginid)),
      onRemoveReviewer: (itemId, loginid) => runReviewItemAction(() => documentsAPI.removeReviewItemReviewer(doc.id, itemId, loginid)),
      onConfirm: (itemId, confirmed) => runReviewItemAction(() => documentsAPI.confirmReviewItem(doc.id, itemId, confirmed)),
    };
  };

  /** 검토 항목 변경 공통 처리 — 응답의 최신 목록으로 갈아끼우고 목록(MY 조건)도 새로 받는다. */
  const runReviewItemAction = async (
    call: () => Promise<{ data: { review_items: ReviewItem[]; message?: string } }>,
  ): Promise<void> => {
    if (!selected) return;
    setProcessing(true);
    try {
      const res = await call();
      setSelected({ ...selected, review_items: res.data.review_items });
      if (res.data.message) addToast(res.data.message, 'success');
      await refreshAndSelect(selected.id);
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const refreshAndSelect = async (docId: number) => {
    const listResult = await documentsAPI.list({});
    const listData = listResult.data;
    let newDocs: RequestDocument[] = Array.isArray(listData) ? listData : (listData as any).results ?? [];
    newDocs = newDocs.filter((d) => d.status !== 'approved');
    setAllDocs(newDocs);
    setDocs(applyClientFilter(newDocs));
    const freshDoc = await documentsAPI.get(docId).then(r => r.data).catch(() => newDocs.find(d => d.id === docId));
    if (freshDoc) setSelected(freshDoc);
  };

  // 합의/반려 버튼 클릭 → comment 모달 열기
  const triggerAgree = (agent: AgentType, isPeer = false, isSalesAgreer = false) => {
    setPendingAction({ type: 'agree', agent, isPeer, isSalesAgreer });
    setCommentInput('');
    setCommentModalOpen(true);
  };

  const triggerReject = (agent: AgentType, isPeer = false, isSalesAgreer = false) => {
    setPendingAction({ type: 'reject', agent, isPeer, isSalesAgreer });
    setCommentInput('');
    setCommentModalOpen(true);
  };

  const handleConfirmAction = async () => {
    if (!selected || !pendingAction) return;
    setCommentModalOpen(false);
    setProcessing(true);
    try {
      if (pendingAction.isSalesAgreer) {
        if (pendingAction.type === 'agree') {
          await documentsAPI.salesAgree(selected.id, commentInput || undefined);
          addToast(t('approval.agree_success', { agent: t('approval.agent_SA' as any) }), 'success');
          setModalOpen(false);
          fetchDocs();
        } else {
          await documentsAPI.salesReject(selected.id, commentInput || undefined);
          addToast(t('approval.reject_success'), 'error');
          await refreshAndSelect(selected.id);
        }
      } else if (pendingAction.isPeer) {
        if (pendingAction.type === 'agree') {
          await documentsAPI.peerApprove(selected.id, commentInput || undefined);
          addToast(t('approval.agree_success', { agent: t('approval.agent_PL' as any) }), 'success');
          setModalOpen(false);
          fetchDocs();
        } else {
          await documentsAPI.peerReject(selected.id, commentInput || undefined);
          addToast(t('approval.reject_success'), 'error');
          await refreshAndSelect(selected.id);
        }
      } else if (pendingAction.type === 'agree') {
        // P/E 담당자 합의 시, 지금 선택돼 있는 검토자(PV/EV)를 함께 지정한다(별도 확인 없이 한 번에 처리).
        const reviewerLoginids = REVIEW_AGENT_OF[pendingAction.agent] ? reviewerSelectedIds : undefined;
        await documentsAPI.approveStep(selected.id, pendingAction.agent, commentInput || undefined, currentUser.name, reviewerLoginids);
        addToast(t('approval.agree_success', { agent: t(`approval.agent_${pendingAction.agent}` as any) }), 'success');
        setModalOpen(false);
        fetchDocs();
      } else {
        await documentsAPI.rejectStep(selected.id, pendingAction.agent, commentInput || undefined);
        const isMaskStage = pendingAction.agent === 'E' || pendingAction.agent === 'EV';
        addToast(
          isMaskStage ? t('approval.request_revision_success') : t('approval.reject_success'),
          isMaskStage ? 'success' : 'error'
        );
        await refreshAndSelect(selected.id);
      }
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
      setPendingAction(null);
      setReviewerSelectedIds([]);
      setReviewerDropdownOpen(false);
    }
  };

  const handlePeerSubmitNav = (doc: RequestDocument) => {
    setModalOpen(false);
    navigate('/request', { state: { peerReviewDocId: doc.id } });
  };

  const handleChangeDesignee = async () => {
    if (!selected || !changingDesigneeUserId) return;
    setProcessing(true);
    try {
      await documentsAPI.changeDesignee(selected.id, changingDesigneeUserId);
      setChangingDesigneeOpen(false);
      setChangingDesigneeUserId('');
      setChangingDesigneeQuery('');
      setChangingDesigneeDropdownOpen(false);
      setTeamMembers([]);
      addToast(t('approval.designee_changed_toast'), 'success');
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleClaim = async (agent: AgentType) => {
    if (!selected) return;
    setProcessing(true);
    try {
      await documentsAPI.claimStep(selected.id, agent);
      await refreshAndSelect(selected.id);
      addToast(t('approval.claim_success'), 'success');
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleUnclaim = async (agent: AgentType) => {
    if (!selected) return;
    setProcessing(true);
    try {
      await documentsAPI.unclaimStep(selected.id, agent);
      await refreshAndSelect(selected.id);
      addToast(t('approval.unclaim_success'), 'success');
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  // ===== 결재 중단(PAUSE) =====
  const handleRequestPauseClick = () => {
    setPauseReasonInput('');
    setPauseReasonModalOpen(true);
  };

  const submitRequestPause = async () => {
    if (!selected || !pauseReasonInput.trim()) return;
    if (isTourMode) {
      // 투어: 실제 API 대신 로컬 상태로 중단 요청을 반영(대상은 요청 시점의 pending 단계 전체)
      const reason = pauseReasonInput.trim();
      const apply = (d: RequestDocument): RequestDocument =>
        d.id !== selected.id ? d : {
          ...d,
          can_request_pause: false,
          pause_request: {
            id: 1,
            state: 'requested',
            reason,
            requester_name: d.requester_name,
            round: 1,
            target_step_ids: (d.approval_steps ?? []).filter((s) => s.action === 'pending').map((s) => s.id),
            confirmed_step_ids: [],
            created_at: new Date().toISOString(),
          },
        };
      setAllDocs((prev) => prev.map(apply));
      setDocs((prev) => prev.map(apply));
      setSelected((prev) => (prev ? apply(prev) : prev));
      setPauseReasonModalOpen(false);
      addToast(t('approval.pause_requested_toast'), 'success');
      return;
    }
    setProcessing(true);
    try {
      await documentsAPI.requestPause(selected.id, pauseReasonInput.trim());
      setPauseReasonModalOpen(false);
      addToast(t('approval.pause_requested_toast'), 'success');
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleConfirmPause = async (agent: AgentType) => {
    if (!selected) return;
    if (isTourMode) {
      // 투어: 실제 API 대신 로컬 상태로 해당 단계만 확인 처리(병렬 대상 전원이 확인해야 최종 'pause' 전이됨을 그대로 반영)
      const apply = (d: RequestDocument): RequestDocument => {
        if (d.id !== selected.id || !d.pause_request) return d;
        const target = (d.approval_steps ?? []).find((s) => s.agent === agent && s.action === 'pending');
        const confirmed = target
          ? Array.from(new Set([...d.pause_request.confirmed_step_ids, target.id]))
          : d.pause_request.confirmed_step_ids;
        const allConfirmed = d.pause_request.target_step_ids.every((id) => confirmed.includes(id));
        return {
          ...d,
          status: allConfirmed ? 'pause' : d.status,
          pause_request: { ...d.pause_request, confirmed_step_ids: confirmed, state: allConfirmed ? 'confirmed' : d.pause_request.state },
        };
      };
      setAllDocs((prev) => prev.map(apply));
      setDocs((prev) => prev.map(apply));
      setSelected((prev) => (prev ? apply(prev) : prev));
      addToast(t('approval.pause_confirm_progress_toast'), 'success');
      return;
    }
    setProcessing(true);
    try {
      const r = await documentsAPI.confirmPause(selected.id, agent);
      if (r.data.status === 'pause') {
        addToast(t('approval.pause_confirmed_toast'), 'success');
        setModalOpen(false);
        fetchDocs();
      } else {
        addToast(t('approval.pause_confirm_progress_toast'), 'success');
        await refreshAndSelect(selected.id);
      }
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelPause = async () => {
    if (!selected) return;
    setProcessing(true);
    try {
      await documentsAPI.cancelPause(selected.id);
      addToast(t('approval.pause_cancelled_toast'), 'success');
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectPause = async () => {
    if (!selected) return;
    setProcessing(true);
    try {
      await documentsAPI.rejectPause(selected.id);
      addToast(t('approval.pause_rejected_toast'), 'success');
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleResumeNav = (doc: RequestDocument) => {
    setModalOpen(false);
    navigate('/request', { state: { editDocId: doc.id } });
  };

  const handleAssign = async (agent: AgentType, loginid: string, userName: string, reviewerLoginid?: string) => {
    if (!selected) return;
    if (isTourMode) {
      // 투어: 실제 API 대신 로컬 상태로 해당 단계에 담당자 배정 결과를 반영
      const apply = (d: RequestDocument): RequestDocument =>
        d.id !== selected.id ? d : {
          ...d,
          approval_steps: (d.approval_steps ?? []).map((s) =>
            s.agent === agent && s.action === 'pending' && !s.assignee_loginid
              ? { ...s, assignee_name: userName, assignee_loginid: loginid }
              : s),
        };
      setAllDocs((prev) => prev.map(apply));
      setDocs((prev) => prev.map(apply));
      setSelected((prev) => (prev ? apply(prev) : prev));
      addToast(t('approval.assign_success'), 'success');
      return;
    }
    setProcessing(true);
    try {
      await documentsAPI.assignStep(selected.id, agent, loginid, userName, reviewerLoginid);
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleAddPostApprover = async (loginid: string) => {
    if (!selected) return;
    setProcessing(true);
    try {
      await documentsAPI.addPostApprover(selected.id, loginid);
      addToast(t('approval.post_approver_add_success'), 'success');
      setPaSearchQuery('');
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleRemovePostApprover = async (loginid: string) => {
    if (!selected) return;
    setProcessing(true);
    try {
      await documentsAPI.removePostApprover(selected.id, loginid);
      addToast(t('approval.post_approver_remove_success'), 'success');
      await refreshAndSelect(selected.id);
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  // 철회 모달 상태 (사유 입력 → 철회 요청 또는 즉시 삭제)
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawDoc, setWithdrawDoc] = useState<RequestDocument | null>(null);
  const [withdrawReasonInput, setWithdrawReasonInput] = useState('');

  // 임시저장 공유 그룹 지정 모달 — 내가 속한 그룹 중 하나를 골라 draft 를 공유한다.
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareDoc, setShareDoc] = useState<RequestDocument | null>(null);
  const [shareGroupId, setShareGroupId] = useState<number | null>(null);
  const [myGroups, setMyGroups] = useState<UserGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  // 공유 그룹을 지정할 수 있는 사람 = 의뢰자 본인 또는 MASTER, 대상은 임시저장 문서뿐.
  // (공유 그룹 멤버는 수정·상신은 되어도 공유 범위는 못 바꾼다 — 서버 인가와 동일 규칙)
  const canSetSharedGroup = (doc: RequestDocument): boolean =>
    doc.status === 'draft' &&
    (currentUser.role === 'MASTER' || doc.requester_loginid === currentUser.username);

  const handleShareClick = (doc: RequestDocument) => {
    setShareDoc(doc);
    setShareGroupId(doc.shared_group ?? null);
    setShareModalOpen(true);
    setGroupsLoading(true);
    userGroupsAPI.list()
      .then(setMyGroups)
      .catch(() => setMyGroups([]))
      .finally(() => setGroupsLoading(false));
  };

  // "나만의 그룹으로 임시저장 공유하기" 하이라이트 가이드 투어 — 실제 목록은 두고
  // 상세 모달/공유 모달 상태만 열 때 스냅샷해 뒀다가 그룹 전환·종료 시 되돌린다.
  const [shareTourOpen, setShareTourOpen] = useState(false);
  const shareTourBaseRef = useRef<{
    selected: RequestDocument | null;
    modalOpen: boolean;
    pageIdx: number;
    shareModalOpen: boolean;
    shareDoc: RequestDocument | null;
    shareGroupId: number | null;
    myGroups: UserGroup[];
  } | null>(null);

  const openShareTour = () => {
    shareTourBaseRef.current = { selected, modalOpen, pageIdx, shareModalOpen, shareDoc, shareGroupId, myGroups };
    setShareTourOpen(true);
  };

  const restoreShareTourBase = () => {
    const base = shareTourBaseRef.current;
    if (!base) return;
    setSelected(base.selected);
    setModalOpen(base.modalOpen);
    setPageIdx(base.pageIdx);
    setShareModalOpen(base.shareModalOpen);
    setShareDoc(base.shareDoc);
    setShareGroupId(base.shareGroupId);
    setMyGroups(base.myGroups);
  };

  const shareTourGroups: StepGuideGroup[] = [
    {
      selectors: ['[data-tour="approval-share-btn"]'],
      title: t('guide.tour.approvalShare.groups.g1.title'),
      description: t('guide.tour.approvalShare.groups.g1.desc'),
      onEnter: () => {
        setSelected(makeShareGuideDemoDoc(currentUser.username));
        setPageIdx(0);
        setModalOpen(true);
      },
    },
    {
      selectors: ['[data-tour="approval-share-modal"]'],
      title: t('guide.tour.approvalShare.groups.g2.title'),
      description: t('guide.tour.approvalShare.groups.g2.desc'),
      onEnter: () => {
        const demoDoc = makeShareGuideDemoDoc(currentUser.username);
        setSelected(demoDoc);
        setPageIdx(0);
        setModalOpen(true);
        handleShareClick(demoDoc);
      },
    },
  ];

  const handleShareSave = async () => {
    if (!shareDoc) return;
    setProcessing(true);
    try {
      await documentsAPI.setSharedGroup(shareDoc.id, shareGroupId);
      addToast(
        shareGroupId === null ? t('approval.share_group_cleared') : t('approval.share_group_saved'),
        'success',
      );
      setShareModalOpen(false);
      setShareDoc(null);
      fetchDocs();
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  // 결재가 진행 중인 문서만 '현재 단계 전원 확인' 절차를 거친다.
  // 임시저장은 확인할 상대가 없어 확인만으로 즉시 삭제된다(사유 없음). 반려는 철회 자체가 불가.
  // MASTER 는 상태와 무관하게 항상 즉시 삭제이므로 확인 절차가 필요 없다(2026-08).
  const needsWithdrawConfirm = (doc: RequestDocument): boolean =>
    currentUser.role !== 'MASTER' && (doc.status === 'under_review' || doc.status === 'submitted');

  const handleWithdrawClick = (doc: RequestDocument) => {
    setWithdrawDoc(doc);
    setWithdrawReasonInput('');
    setWithdrawModalOpen(true);
  };

  const submitWithdraw = async () => {
    if (!withdrawDoc) return;
    setProcessing(true);
    try {
      const r = await documentsAPI.withdraw(withdrawDoc.id, withdrawReasonInput.trim());
      setWithdrawModalOpen(false);
      if (r.data.deleted) {
        addToast(t('approval.withdraw_success'), 'success');
        setModalOpen(false);
        fetchDocs();
      } else {
        addToast(t('approval.withdraw_requested_toast'), 'success');
        await refreshAndSelect(withdrawDoc.id);
      }
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
      setWithdrawDoc(null);
    }
  };

  const handleConfirmWithdraw = async (agent: AgentType) => {
    if (!selected) return;
    setProcessing(true);
    try {
      const r = await documentsAPI.confirmWithdraw(selected.id, agent);
      if (r.data.deleted) {
        addToast(t('approval.withdraw_confirmed_toast'), 'success');
        setModalOpen(false);
        fetchDocs();
      } else {
        addToast(t('approval.withdraw_confirm_progress_toast'), 'success');
        await refreshAndSelect(selected.id);
      }
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectWithdraw = async () => {
    if (!selected) return;
    setProcessing(true);
    try {
      await documentsAPI.rejectWithdraw(selected.id);
      addToast(t('approval.withdraw_rejected_toast'), 'success');
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelWithdraw = async () => {
    if (!selected) return;
    setProcessing(true);
    try {
      await documentsAPI.cancelWithdraw(selected.id);
      addToast(t('approval.withdraw_cancelled_toast'), 'success');
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleEditResubmit = (doc: RequestDocument) => {
    setModalOpen(false);
    navigate('/request', { state: { editDocId: doc.id } });
  };

  const isPL = currentUser.role === 'PL';
  const isMaster = currentUser.role === 'MASTER';
  const isNone = currentUser.role === 'NONE';

  // ===== 필터 바(라인/목적/MAP 목적/요청일) =====
  const mapPurposeLabel = (v: string): string => (v === MAP_PURPOSE_NA ? t('approval.step_na') : v);

  const toggleFilterValue = (setFn: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) => {
    setFn((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const resetColumnFilters = () => {
    setLineFilter(new Set());
    setPurposeFilter(new Set());
    setMapFilter(new Set());
    setDateFrom('');
    setDateTo('');
  };

  const applyDatePreset = (days: number) => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - days);
    setDateTo(to.toISOString().slice(0, 10));
    setDateFrom(from.toISOString().slice(0, 10));
  };

  const renderFilterSummary = (
    label: string, selected: Set<string>, labelFn: (v: string) => string = (v) => v,
  ): React.ReactNode => {
    if (selected.size === 0) return <>{label} <span className="caret">▾</span></>;
    const arr = Array.from(selected);
    const summary = arr.length === 1
      ? labelFn(arr[0])
      : t('approval.filter_summary_more', { first: labelFn(arr[0]), count: arr.length - 1 });
    return <>{label}: {summary} <span className="count">{selected.size}</span> <span className="caret">▾</span></>;
  };

  const renderCheckboxPopover = (
    options: readonly string[],
    selected: Set<string>,
    setFn: React.Dispatch<React.SetStateAction<Set<string>>>,
    labelFn: (v: string) => string = (v) => v,
  ): React.ReactNode => (
    <div className="column-filter-popover">
      <button type="button" className="column-filter-popover-all" onClick={() => setFn(new Set(options))}>
        {t('approval.filter_select_all')}
      </button>
      <button type="button" className="column-filter-popover-all" onClick={() => setFn(new Set())}>
        {t('approval.filter_select_none')}
      </button>
      <div className="column-filter-popover-divider" />
      {options.map((opt) => (
        <label key={opt} className="column-filter-popover-item">
          <input type="checkbox" checked={selected.has(opt)} onChange={() => toggleFilterValue(setFn, opt)} />
          {labelFn(opt)}
        </label>
      ))}
    </div>
  );

  const hasColumnFilter = lineFilter.size > 0 || purposeFilter.size > 0 || mapFilter.size > 0 || !!dateFrom || !!dateTo;

  return (
    <div className="container page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {t('approval.title')}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); openShareTour(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openShareTour(); }
            }}
            className={`guide-video-badge${shareTourOpen ? ' active' : ''}`}
            style={{ fontSize: '0.7rem' }}
          >
            {t('guide.video_btn')}
          </span>
        </h1>
        <p>{t('approval.subtitle')}</p>
      </div>


      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('approval.search_placeholder')}
          />
        </div>
        <div className="filter-tabs">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              data-tour={tab.key === 'my' ? 'approval-my-tab' : undefined}
              className={`filter-tab ${filter === tab.key ? 'active' : ''}`}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="column-filter-bar" ref={filterBarRef}>
        <span className="column-filter-bar-label">{t('approval.filter_bar_label')}</span>

        <div className="column-filter-anchor">
          <button
            type="button"
            className={`column-filter-btn${lineFilter.size ? ' active' : ''}`}
            onClick={() => setOpenFilterDropdown((k) => (k === 'line' ? null : 'line'))}
          >
            {renderFilterSummary(t('approval.col_line'), lineFilter)}
          </button>
          {openFilterDropdown === 'line' && renderCheckboxPopover(OPTION_LINE, lineFilter, setLineFilter)}
        </div>

        <div className="column-filter-anchor">
          <button
            type="button"
            className={`column-filter-btn${purposeFilter.size ? ' active' : ''}`}
            onClick={() => setOpenFilterDropdown((k) => (k === 'purpose' ? null : 'purpose'))}
          >
            {renderFilterSummary(t('approval.col_purpose'), purposeFilter)}
          </button>
          {openFilterDropdown === 'purpose' && renderCheckboxPopover(OPTION_REQUEST_PURPOSE, purposeFilter, setPurposeFilter)}
        </div>

        <div className="column-filter-anchor">
          <button
            type="button"
            className={`column-filter-btn${mapFilter.size ? ' active' : ''}`}
            onClick={() => setOpenFilterDropdown((k) => (k === 'map' ? null : 'map'))}
          >
            {renderFilterSummary(t('approval.col_map_purpose'), mapFilter, mapPurposeLabel)}
          </button>
          {openFilterDropdown === 'map' && renderCheckboxPopover(MAP_PURPOSE_OPTIONS, mapFilter, setMapFilter, mapPurposeLabel)}
        </div>

        <div className="column-filter-anchor">
          <button
            type="button"
            className={`column-filter-btn${dateFrom || dateTo ? ' active' : ''}`}
            onClick={() => setOpenFilterDropdown((k) => (k === 'date' ? null : 'date'))}
          >
            {dateFrom || dateTo
              ? `${dateFrom || '…'} ~ ${dateTo || '…'}`
              : t('approval.col_submitted')} <span className="caret">▾</span>
          </button>
          {openFilterDropdown === 'date' && (
            <div className="column-filter-popover">
              <div className="column-filter-date-row">
                <input
                  type="date"
                  aria-label={t('approval.filter_date_from')}
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
                <span style={{ color: 'var(--text-disabled)', fontSize: '0.78rem' }}>~</span>
                <input
                  type="date"
                  aria-label={t('approval.filter_date_to')}
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
              <div className="column-filter-date-presets">
                <button type="button" className="column-filter-date-preset-btn" onClick={() => applyDatePreset(7)}>
                  {t('approval.filter_preset_7')}
                </button>
                <button type="button" className="column-filter-date-preset-btn" onClick={() => applyDatePreset(30)}>
                  {t('approval.filter_preset_30')}
                </button>
                <button
                  type="button"
                  className="column-filter-date-preset-btn"
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                >
                  {t('approval.filter_all')}
                </button>
              </div>
            </div>
          )}
        </div>

        {hasColumnFilter && (
          <button type="button" className="column-filter-reset" onClick={resetColumnFilters}>
            {t('common.reset')}
          </button>
        )}

        <span className="column-filter-count">
          {t('approval.filter_count', { total: docs.length, count: sortedDocs.length })}
        </span>
      </div>

      {loading ? (
        <div className="empty-state"><p>{t('common.loading')}</p></div>
      ) : error ? (
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <p>{t('common.load_error')}</p>
          <button className="btn" onClick={fetchDocs}>{t('common.retry')}</button>
        </div>
      ) : sortedDocs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <p>{t('approval.no_data')}</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th
                  className="sortable-col"
                  onClick={() => toggleColSort('line')}
                  title={t('approval.col_production_date_sort_hint' as never)}
                >
                  {t('approval.col_line')}{colSortIndicator('line')}
                </th>
                <th
                  className="sortable-col"
                  onClick={() => toggleColSort('purpose')}
                  title={t('approval.col_production_date_sort_hint' as never)}
                >
                  {t('approval.col_purpose')}{colSortIndicator('purpose')}
                </th>
                <th
                  className="sortable-col"
                  onClick={() => toggleColSort('mapType')}
                  title={t('approval.col_production_date_sort_hint' as never)}
                >
                  {t('approval.col_map_purpose')}{colSortIndicator('mapType')}
                </th>
                <th>{t('approval.col_product_combo')}</th>
                <th
                  className="sortable-col"
                  onClick={() => toggleColSort('submitted')}
                  title={t('approval.col_production_date_sort_hint' as never)}
                >
                  {t('approval.col_submitted')}{colSortIndicator('submitted')}
                </th>
                <th>{t('approval.col_requester')}</th>
                <th>{t('approval.col_current_stage')}</th>
                <th>{t('approval.col_final_completion')}</th>
                <th
                  onClick={toggleProdDateSort}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  title={t('approval.col_production_date_sort_hint' as never)}
                >
                  {t('approval.col_production_date')}
                  {prodDateSort === 'asc' ? ' ▲' : prodDateSort === 'desc' ? ' ▼' : (
                    <span style={{ color: 'var(--text-muted)' }}> ⇅</span>
                  )}
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pagedDocs.map((doc) => {
                // 병렬 진입 후에도 문서 1건은 표 1행이다 — 경로별 행 분리·rowSpan 병합은 없어졌고,
                // 현재 단계 칸 안의 3행 2열 그리드가 6개 경로를 모두 보여준다(docs/APPROVAL.md §3.3).
                const row = getDocTableRows(doc, t)[0];
                const isPaused = doc.status === 'pause';
                const lastRejection = getLastRejectionInfo(doc, t);
                const detail = getDocDetailFields(doc);
                const comboText = [detail.processSelection, detail.partidSelection, detail.processId]
                  .filter(Boolean).join(' · ') || '-';
                const isTourTitleCell = isTourMode && doc.id === TOUR_APPROVAL_DETAIL_DOC.id;
                return (
                  <tr key={doc.id}>
                    <td><b>{detail.line || '-'}</b></td>
                    <td>
                      <div className="purpose-cell">
                        <span className="purpose-cell-main">{detail.purpose || '-'}</span>
                        {detail.otherPurpose.map((o) => (
                          <span key={o} className="purpose-cell-sub">{o}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {detail.isAdiCd ? (
                        <span className="map-purpose-na">{t('approval.step_na')}</span>
                      ) : (detail.mapType || '-')}
                    </td>
                    <td>
                      {isNone ? (
                        <span
                          data-tour={isTourTitleCell ? 'approval-doc-title' : undefined}
                          style={{ fontWeight: 600, fontSize: '0.85rem' }}
                        >
                          {comboText}
                        </span>
                      ) : (
                        <button
                          data-tour={isTourTitleCell ? 'approval-doc-title' : undefined}
                          className="product-combo-link"
                          onClick={() => openDetail(doc)}
                        >
                          {comboText}
                        </button>
                      )}
                      {detail.adiExtraCount > 0 && <span className="adi-extra-badge">+{detail.adiExtraCount}</span>}
                      {lastRejection && (
                        <div style={{ marginTop: 4 }}>
                          <span className="rejection-history-chip">
                            {t('approval.rejection_history_chip', { round: lastRejection.round, stage: lastRejection.stageLabel })}
                          </span>
                        </div>
                      )}
                    </td>
                    <td>{formatDate(getDocSubmittedDate(doc))}</td>
                    <td>
                      <div>{doc.requester_name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{doc.requester_department}</div>
                    </td>
                    <td
                      style={{ fontWeight: 500 }}
                      data-tour={isTourMode && doc.id === TOUR_APPROVAL_DETAIL_DOC.id ? 'approval-stage' : undefined}
                    >
                      {row.cells ? (
                        <StageGrid cells={row.cells} columns={row.gridColumns} />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <StatusBadge status={row.pathStatus} />
                          <span style={{ color: row.isDone ? 'var(--text-disabled)' : 'var(--text-primary)' }}>{row.stageText}</span>
                          {row.pauseRequested && (
                            <span className="pause-req-chip">⏸ {t('approval.pause_requested_chip')}</span>
                          )}
                        </div>
                      )}
                      {/* 철회 요청중 칩은 단일 행·그리드 표시 양쪽에서 모두 보여야 한다 */}
                      {doc.withdraw_request && (
                        <div style={{ marginTop: 4 }}>
                          <span className="withdraw-req-chip">🗑️ {t('approval.withdraw_requested_chip')}</span>
                        </div>
                      )}
                    </td>
                    <td>{isPaused ? <span style={{ color: 'var(--text-muted)' }}>{t('approval.filter_pause')}</span> : getFinalCompletionDate(doc)}</td>
                    <td>{doc.production_date ? formatDate(doc.production_date) : '-'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {doc.can_edit && (doc.status === 'rejected' || doc.status === 'draft') && (
                          <button className="btn btn-primary btn-sm" onClick={() => handleEditResubmit(doc)}>
                            {t('approval.edit_resubmit')}
                          </button>
                        )}
                        {doc.can_requester_resubmit && (
                          <button className="btn btn-primary btn-sm" onClick={() => handleEditResubmit(doc)}>
                            {t('approval.requester_resubmit')}
                          </button>
                        )}
                        {canSetSharedGroup(doc) && (
                          <button className="btn btn-secondary btn-sm" onClick={() => handleShareClick(doc)} disabled={processing}>
                            👥 {doc.shared_group_name ?? t('approval.share_group_btn')}
                          </button>
                        )}
                        {doc.can_withdraw && (doc.status === 'under_review' || doc.status === 'draft' || currentUser.role === 'MASTER') && (
                          <button
                            className="btn btn-secondary btn-sm"
                            data-tour={isTourMode && doc.id === TOUR_APPROVAL_DETAIL_DOC.id ? 'approval-withdraw' : undefined}
                            onClick={() => handleWithdrawClick(doc)}
                            disabled={processing}
                          >
                            {t('approval.withdraw')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && sortedDocs.length > 0 && totalListPages > 1 && (
        <div className="pagination" role="navigation" aria-label={t('approval.pagination_nav')}>
          <button
            type="button"
            className="pagination-btn"
            onClick={() => setListPage((p) => Math.max(1, p - 1))}
            disabled={listPage === 1}
            aria-label={t('common.prev')}
          >
            ◀
          </button>
          {buildPageNumbers(listPage, totalListPages).map((item, idx) =>
            item === 'ellipsis' ? (
              <span key={`ellipsis-${idx}`} className="pagination-ellipsis">…</span>
            ) : (
              <button
                key={item}
                type="button"
                className={`pagination-btn ${item === listPage ? 'active' : ''}`}
                onClick={() => setListPage(item)}
                aria-current={item === listPage ? 'page' : undefined}
                aria-label={t('approval.pagination_go_to_page', { page: item })}
              >
                {item}
              </button>
            )
          )}
          <button
            type="button"
            className="pagination-btn"
            onClick={() => setListPage((p) => Math.min(totalListPages, p + 1))}
            disabled={listPage === totalListPages}
            aria-label={t('common.next')}
          >
            ▶
          </button>
        </div>
      )}

      {/* 합의/반려 이유 입력 모달 */}
      {commentModalOpen && pendingAction && (
        <Modal
          isOpen={commentModalOpen}
          onClose={() => { setCommentModalOpen(false); setPendingAction(null); }}
          title={pendingAction.type === 'agree' ? t('approval.modal_agree_title', { agent: t(`approval.agent_${pendingAction.agent}` as any) }) : t('approval.modal_reject_title', { agent: t(`approval.agent_${pendingAction.agent}` as any) })}
          size="md"
          topLevel
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className={pendingAction.type === 'agree' ? 'btn btn-primary' : 'btn btn-danger'}
                onClick={handleConfirmAction}
                disabled={processing}
              >
                {t('common.confirm')}
              </button>
              <button className="btn btn-secondary" onClick={() => { setCommentModalOpen(false); setPendingAction(null); }}>
                {t('common.cancel')}
              </button>
            </div>
          }
        >
          <div>
            <p style={{ marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              {pendingAction.type === 'agree' ? t('approval.comment_agree_label') : t('approval.comment_reject_label')}
            </p>
            <textarea
              className="form-control"
              rows={4}
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              placeholder={pendingAction.type === 'agree' ? t('approval.comment_agree_placeholder') : t('approval.comment_reject_placeholder')}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </div>
        </Modal>
      )}

      {/* 중단 요청 사유 입력 모달 */}
      {pauseReasonModalOpen && (
        <Modal
          isOpen={pauseReasonModalOpen}
          onClose={() => setPauseReasonModalOpen(false)}
          title={t('approval.pause_request_modal_title')}
          size="md"
          topLevel
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-pause"
                data-tour={isTourMode ? 'pause-request-submit' : undefined}
                onClick={submitRequestPause}
                disabled={processing || !pauseReasonInput.trim()}
              >
                {t('approval.pause_request_submit')}
              </button>
              <button className="btn btn-secondary" onClick={() => setPauseReasonModalOpen(false)} disabled={processing}>
                {t('common.cancel')}
              </button>
            </div>
          }
        >
          <div>
            <p style={{ marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              {t('approval.pause_reason_label')} <span style={{ color: 'var(--danger)' }}>*</span>
            </p>
            <textarea
              className="form-control"
              rows={4}
              value={pauseReasonInput}
              onChange={(e) => setPauseReasonInput(e.target.value)}
              placeholder={t('approval.pause_reason_placeholder')}
              style={{ width: '100%', resize: 'vertical' }}
            />
            <p style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {t('approval.pause_reason_hint')}
            </p>
          </div>
        </Modal>
      )}

      {/* 임시저장 공유 그룹 지정 모달 — 내가 속한 그룹 중 1개(또는 공유 안 함) */}
      {shareModalOpen && shareDoc && (
        <Modal
          isOpen={shareModalOpen}
          onClose={() => { setShareModalOpen(false); setShareDoc(null); }}
          title={t('approval.share_group_title')}
          size="md"
          topLevel
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => { setShareModalOpen(false); setShareDoc(null); }} disabled={processing}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleShareSave} disabled={processing || groupsLoading}>
                {processing ? t('common.loading') : t('common.save')}
              </button>
            </div>
          }
        >
          <div data-tour="approval-share-modal">
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
              {t('approval.share_group_help')}
            </p>
            {groupsLoading ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('common.loading')}</p>
            ) : myGroups.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('approval.share_group_empty')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="shared-group"
                    checked={shareGroupId === null}
                    onChange={() => setShareGroupId(null)}
                  />
                  <span style={{ fontSize: '0.9rem' }}>{t('approval.share_group_none')}</span>
                </label>
                {myGroups.map((g) => (
                  <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="shared-group"
                      checked={shareGroupId === g.id}
                      onChange={() => setShareGroupId(g.id)}
                    />
                    <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{g.name}</span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {t('group.member_count', { count: g.members.length })}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* 철회 모달 — 진행 중 문서는 사유를 받아 철회 요청, 임시저장은 확인만 받아 즉시 삭제한다 */}
      {withdrawModalOpen && withdrawDoc && (
        <Modal
          isOpen={withdrawModalOpen}
          onClose={() => { setWithdrawModalOpen(false); setWithdrawDoc(null); }}
          title={t('approval.withdraw_modal_title')}
          size="md"
          topLevel
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-danger"
                onClick={submitWithdraw}
                disabled={processing || (needsWithdrawConfirm(withdrawDoc) && !withdrawReasonInput.trim())}
              >
                {needsWithdrawConfirm(withdrawDoc)
                  ? t('approval.withdraw_submit')
                  : t('approval.withdraw_submit_immediate')}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => { setWithdrawModalOpen(false); setWithdrawDoc(null); }}
                disabled={processing}
              >
                {t('common.cancel')}
              </button>
            </div>
          }
        >
          <div>
            <div className="withdraw-warning">⚠️ {t('approval.withdraw_warning')}</div>
            {withdrawDoc.status === 'draft' ? (
              <p style={{ margin: '12px 0 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                {t('approval.withdraw_confirm_draft_message')}
              </p>
            ) : (
              <>
                <p style={{ margin: '12px 0 8px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  {t('approval.withdraw_reason_label')}
                  {needsWithdrawConfirm(withdrawDoc) && <span style={{ color: 'var(--danger)' }}> *</span>}
                </p>
                <textarea
                  className="form-control"
                  rows={4}
                  value={withdrawReasonInput}
                  onChange={(e) => setWithdrawReasonInput(e.target.value)}
                  placeholder={t('approval.withdraw_reason_placeholder')}
                  style={{ width: '100%', resize: 'vertical' }}
                />
                <p style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {t('approval.withdraw_reason_hint')}
                </p>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* 상세 모달 */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={selected?.title ?? ''}
        titleExtra={selected && (
          <button
            onClick={async () => {
              const screenshots = await pagedDetailViewRef.current?.captureAllScreenshots()
                ?? { detail: null, map: null };
              await exportAllXlsx(selected, t, screenshots);
            }}
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '0.75rem', padding: '2px 10px' }}
          >
            📊 {t('request.export_all_btn')}
          </button>
        )}
        size="xl"
        footer={(() => {
          if (!selected) return null;
          const userAgent = currentUser.role ? ROLE_TO_AGENT[currentUser.role] : undefined;
          // 진행 중(under_review) 문서의 현재 회차 단계만 대상 — 반려/승인된 문서에는 잔여
          // pending step 이 이력으로 남고 재상신 시 이전 회차 step 도 남으므로, 상태·회차를
          // 확인하지 않으면 종료된 문서에서도 합의/반려/검토중/지정하기 버튼이 노출된다.
          const currentRound = getCurrentRound(selected);
          const pendingSteps = selected?.approval_steps?.filter((s) => {
            if (s.action !== 'pending') return false;
            if (selected.status !== 'under_review') return false;
            if ((s.round ?? 1) !== currentRound) return false;
            if (isMaster) return true;
            if (isPL && s.agent === 'PL') return true;
            // 본인이 배정된 단계(RV 검토자·RA 후결자 포함)도 노출
            if (s.assignee_loginid && s.assignee_loginid === currentUser.username) return true;
            return s.agent === userAgent;
          }) ?? [];
          // 철회/중단 요청이 확인 대기 중(requested)이면 결재 진행 액션(지정·합의·검토중·검토중취소)을
          // 전부 숨긴다 — 서버 _blocked_progress_response 의 동결과 대칭이다. 확인 대상 단계뿐 아니라
          // 문서 전체를 얼리는 이유는, 병렬 단계 중 아직 확인 안 된 쪽이 그 사이 합의까지 끝내버리면
          // 중단·철회 요청 자체가 무의미해지기 때문이다(대상이 되지 않은 단계도 동일하게 막는다).
          const progressFrozen = selected?.withdraw_request != null
            || selected?.pause_request?.state === 'requested';
          // 투어 모드에서는 '지정하기' 시연을 위해 R 단계(아직 미지정)를 지정 가능 단계로 본다.
          // 배정 후에는 assignee_loginid가 채워져 자동으로 사라진다(실제 동작과 동일).
          const assignableStep = isTourMode
            ? selected?.approval_steps?.find((s) => s.agent === 'R' && s.action === 'pending' && !s.assignee_loginid)
            : (progressFrozen ? undefined : pendingSteps.find((s) => canUserAssign(currentUser, s)));
          // RV/PV/EV(검토자)는 담당자(R/P/E) 합의 후에만 처리 가능 → 그 전엔 actable 에서 제외
          const mainStepApproved = (mainAgent: string) => (selected?.approval_steps ?? []).some(
            (s) => s.agent === mainAgent && s.action === 'approved' && (s.round ?? 1) === currentRound
          );
          const REVIEW_MAIN_AGENT: Record<string, string> = { RV: 'R', PV: 'P', EV: 'E' };
          const actableStep = progressFrozen ? undefined : pendingSteps.find((s) => {
            if (!canUserAgree(currentUser, s)) return false;
            const mainAgent = REVIEW_MAIN_AGENT[s.agent];
            return !mainAgent || mainStepApproved(mainAgent);
          });
          const isPLStep = actableStep?.agent === 'PL';
          // 영업/기술지원 합의자 — PL 검토와 병렬이지만 전용 API(sales-agree/reject)를 쓴다.
          const isSalesAgreerStep = actableStep?.agent === 'SA';
          // 검토중(claim) 가능 단계: J/O/E/P 중 담당 역할이 아직 미배정인 단계를 선점
          const claimableStep = (isTourMode || progressFrozen) ? undefined : pendingSteps.find((s) => canUserClaim(currentUser, s));
          // 검토중 취소 가능 단계: 내가 선점한 J/O/E/P 단계를 다시 대기중으로 되돌린다.
          const unclaimableStep = (isTourMode || progressFrozen) ? undefined : pendingSteps.find((s) => canUserUnclaim(currentUser, s));
          // 검토자 선택 UI 대상: 지금 '합의'를 누를 수 있는 단계가 P/E일 때 그 단계에 검토자를 함께 지정한다.
          const reviewerPickStep = (!isTourMode && actableStep && REVIEW_AGENT_OF[actableStep.agent]) ? actableStep : undefined;
          const existingReviewerLoginids = reviewerPickStep
            ? (selected?.approval_steps ?? [])
                .filter((s) => s.agent === REVIEW_AGENT_OF[reviewerPickStep.agent] && (s.round ?? 1) === currentRound)
                .map((s) => s.assignee_loginid)
                .filter((v): v is string => !!v)
            : [];
          // MASK(E) 는 2차 검토자 1명 이상 지정이 필수다 — 아직 아무도 없으면 '합의'를 막는다.
          // (P 단계의 검토자는 선택 사항이라 이 판정에서 제외된다.)
          // existingReviewerLoginids 를 함께 보는 이유: 이 배포 이전에 되감겨 EV step 이
          // 살아남은 문서에서, 후보에서 제외된 그 검토자 때문에 잠기지 않게 한다.
          const needsReviewerPick = reviewerPickStep?.agent === 'E'
            && reviewerSelectedIds.length === 0
            && existingReviewerLoginids.length === 0;

          // 지정자 변경 가능 여부: 원 PL 또는 MASTER, under_review, PL 단계 pending
          const hasPendingPLStep = (selected?.approval_steps ?? []).some(s => s.agent === 'PL' && s.action === 'pending');
          const isOriginalPL = isPL && selected?.requester_name === currentUser.name;
          const canChangeDesignee = (isOriginalPL || isMaster) && selected?.status === 'under_review' && hasPendingPLStep;

          // 중단(PAUSE) 관련 버튼 노출 계산
          const pr = selected?.pause_request;
          const isPauseRequester = selected
            ? (selected.requester_loginid
                ? selected.requester_loginid === currentUser.username
                : selected.requester_name === currentUser.name)
            : false;
          // 확인 가능한 대상 단계(요청됨 상태 + target pending + 미확인 + 확인권한)
          // 투어 모드에서는 시연을 위해 확인 권한(canConfirmPauseStep) 판정을 건너뛴다(지정하기 시연과 동일한 패턴).
          let pauseConfirmAgent: AgentType | undefined;
          if (pr && pr.state === 'requested') {
            const target = (selected?.approval_steps ?? []).find(
              (s) => s.action === 'pending'
                && pr.target_step_ids.includes(s.id)
                && !pr.confirmed_step_ids.includes(s.id)
                && (isTourMode || canConfirmPauseStep(currentUser, s))
            );
            pauseConfirmAgent = target?.agent;
          }

          // 철회 요청 관련 버튼 노출 계산 (확인 인가는 중단 확인과 동일 규칙)
          const wr = selected?.withdraw_request;
          let withdrawConfirmAgent: AgentType | undefined;
          if (wr) {
            const target = (selected?.approval_steps ?? []).find(
              (s) => s.action === 'pending'
                && wr.target_step_ids.includes(s.id)
                && !wr.confirmed_step_ids.includes(s.id)
                && canConfirmPauseStep(currentUser, s)
            );
            withdrawConfirmAgent = target?.agent;
          }
          // 철회 요청 취소는 '요청한 본인'만 — 작성자가 아니라 요청자 기준(서버와 동일)
          const canCancelWithdraw = !!wr
            && (isMaster || (!!wr.requester_loginid && wr.requester_loginid === currentUser.username));

          // 후결자 관리: 작성자 또는 MASTER + under_review + 병렬 단계(R 합의 이후) 진입 후 항상 노출
          const fixedPa = selected?.post_approver_fixed_loginid ?? '';
          const raSteps = (selected?.approval_steps ?? []).filter(
            (s) => s.agent === 'RA' && (s.round ?? 1) === currentRound && s.assignee_loginid !== fixedPa
          );
          const fixedRaStep = (selected?.approval_steps ?? []).find(
            (s) => s.agent === 'RA' && (s.round ?? 1) === currentRound && s.assignee_loginid === fixedPa
          );
          const parallelReached = (selected?.approval_steps ?? []).some(
            (s) => (s.round ?? 1) === currentRound && ['P', 'O', 'E', 'RA'].includes(s.agent)
          );
          const canManagePa = !!selected && (isMaster || isPauseRequester) && selected.status === 'under_review' && parallelReached;

          return (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center' }}>
              {/* 후결자 관리: 고정 후결자는 잠금 칩(제거 불가), 추가 후결자는 ×로 제거, '+ 후결자 추가'로 검색해 추가 */}
              {canManagePa && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {t('approval.post_approver_label')}
                  </span>
                  {fixedRaStep && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px dashed var(--border)', borderRadius: 20, padding: '3px 10px', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      🔒 {fixedRaStep.assignee_name || fixedRaStep.assignee_loginid}
                      <small style={{ fontWeight: 700, color: 'var(--text-disabled)' }}>{t('approval.post_approver_fixed_tag')}</small>
                    </span>
                  )}
                  {raSteps.map((s) => (
                    <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 8px 3px 10px', fontSize: '0.8rem' }}>
                      {s.assignee_name || s.assignee_loginid}
                      {s.action === 'pending' && (
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => handleRemovePostApprover(s.assignee_loginid || '')}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1, padding: 0 }}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                  <div style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={processing}
                      onClick={async () => {
                        if (!paAddOpen && paCandidates.length === 0) {
                          setLoadingMembers(true);
                          try { const r = await usersAPI.list('PL'); setPaCandidates(r.data); } catch { setPaCandidates([]); }
                          setLoadingMembers(false);
                        }
                        setPaAddOpen((o) => !o);
                      }}
                    >
                      + {t('approval.post_approver_add_btn')}
                    </button>
                    {paAddOpen && (
                      <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, width: 240, background: 'var(--bg-modal)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-lg)', zIndex: 9999, padding: 6 }}>
                        <input
                          type="text"
                          className="form-control"
                          placeholder={t('approval.post_approver_search_placeholder')}
                          value={paSearchQuery}
                          onChange={(e) => setPaSearchQuery(e.target.value)}
                          autoFocus
                          autoComplete="off"
                          style={{ fontSize: '0.82rem', padding: '4px 8px', marginBottom: 4 }}
                        />
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 200, overflowY: 'auto' }}>
                          {(() => {
                            if (loadingMembers) {
                              return <li style={{ padding: '8px 4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('common.loading')}</li>;
                            }
                            const excluded = new Set([fixedPa, ...raSteps.map((s) => s.assignee_loginid)]);
                            const q = paSearchQuery.toLowerCase();
                            const options = paCandidates.filter((u) =>
                              !excluded.has(u.loginid) &&
                              (!q || u.name.toLowerCase().includes(q) || u.loginid.toLowerCase().includes(q) || (u.mail ?? '').toLowerCase().includes(q))
                            );
                            if (options.length === 0) {
                              return <li style={{ padding: '8px 4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('approval.no_team_members')}</li>;
                            }
                            return options.map((u) => (
                              <li
                                key={u.loginid}
                                onMouseDown={(e) => { e.preventDefault(); handleAddPostApprover(u.loginid); setPaAddOpen(false); }}
                                style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 4 }}
                                onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)'; }}
                                onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.background = 'transparent'; }}
                              >
                                <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{u.name}</div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{u.loginid}{u.mail ? ` · ${u.mail}` : ''}</div>
                              </li>
                            ));
                          })()}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* 중단 요청 (작성자·진행 중) */}
              {selected && selected.can_request_pause && (
                <button
                  className="btn btn-pause"
                  data-tour={isTourMode ? 'pause-request-btn' : undefined}
                  onClick={handleRequestPauseClick}
                  disabled={processing}
                >
                  {t('approval.pause_request')}
                </button>
              )}
              {/* 중단 확인 (현재 단계 담당자/팀) */}
              {pauseConfirmAgent && (
                <button
                  className="btn btn-pause"
                  data-tour={isTourMode ? 'pause-confirm-btn' : undefined}
                  onClick={() => handleConfirmPause(pauseConfirmAgent as AgentType)}
                  disabled={processing}
                >
                  {t('approval.pause_confirm')}
                </button>
              )}
              {/* 중단 거부 (확인할 수 있는 사람이면 거부도 가능) */}
              {pauseConfirmAgent && (
                <button className="btn btn-secondary" onClick={handleRejectPause} disabled={processing}>
                  {t('approval.pause_reject')}
                </button>
              )}
              {/* 중단 요청 취소 (요청됨 상태 + 작성자) */}
              {pr && pr.state === 'requested' && isPauseRequester && (
                <button className="btn btn-secondary" onClick={handleCancelPause} disabled={processing}>
                  {t('approval.pause_cancel')}
                </button>
              )}
              {/* 재개 (작성자·pause) */}
              {selected && selected.can_resume && (
                <button className="btn btn-primary" onClick={() => handleResumeNav(selected)} disabled={processing}>
                  {t('approval.resume')}
                </button>
              )}
              {selected && selected.can_edit && (selected.status === 'rejected' || selected.status === 'draft') && (
                <button className="btn btn-primary" onClick={() => handleEditResubmit(selected)}>
                  {t('approval.edit_resubmit')}
                </button>
              )}
              {/* 의뢰자 재상신(중단요청 없이): PL 검토(+SA 합의) 단계에서만 노출 */}
              {selected && selected.can_requester_resubmit && (
                <button className="btn btn-primary" onClick={() => handleEditResubmit(selected)}>
                  {t('approval.requester_resubmit')}
                </button>
              )}
              {selected && canSetSharedGroup(selected) && (
                <button
                  className="btn btn-secondary"
                  data-tour="approval-share-btn"
                  onClick={() => handleShareClick(selected)}
                  disabled={processing}
                >
                  👥 {selected.shared_group_name ?? t('approval.share_group_btn')}
                </button>
              )}
              {/* 철회 확인 (현재 단계 담당자/팀) — 전원 확인 시 의뢰서가 삭제된다 */}
              {withdrawConfirmAgent && (
                <button className="btn btn-danger" onClick={() => handleConfirmWithdraw(withdrawConfirmAgent as AgentType)} disabled={processing}>
                  {t('approval.withdraw_confirm')}
                </button>
              )}
              {/* 철회 거부 (확인할 수 있는 사람이면 거부도 가능) */}
              {withdrawConfirmAgent && (
                <button className="btn btn-secondary" onClick={handleRejectWithdraw} disabled={processing}>
                  {t('approval.withdraw_reject')}
                </button>
              )}
              {/* 철회 요청 취소 (요청자 본인·확인 완료 전) */}
              {canCancelWithdraw && (
                <button className="btn btn-secondary" onClick={handleCancelWithdraw} disabled={processing}>
                  {t('approval.withdraw_cancel')}
                </button>
              )}
              {/* 철회 요청 중에는 중복 요청을 막기 위해 철회 버튼을 감춘다 */}
              {selected && selected.can_withdraw && !wr && (selected.status === 'under_review' || selected.status === 'draft' || isMaster) && (
                <button className="btn btn-secondary" onClick={() => handleWithdrawClick(selected)} disabled={processing}>
                  {t('approval.withdraw')}
                </button>
              )}
              {/* 지정자 변경 */}
              {canChangeDesignee && !changingDesigneeOpen && !assigningOpen && (
                <button
                  className="btn btn-secondary"
                  disabled={processing}
                  onClick={async () => {
                    setChangingDesigneeOpen(true);
                    setChangingDesigneeUserId('');
                    setLoadingMembers(true);
                    const members = await usersAPI.list('PL');
                    setTeamMembers(members.data.filter(u => u.loginid !== currentUser.username));
                    setLoadingMembers(false);
                  }}
                >
                  {t('approval.change_designee')}
                </button>
              )}
              {canChangeDesignee && changingDesigneeOpen && (
                <>
                  <div ref={changingDesigneeRef} style={{ position: 'relative' }}>
                    <input
                      type="text"
                      className="form-control"
                      value={changingDesigneeQuery}
                      placeholder={loadingMembers ? t('common.loading') : t('approval.designee_search_placeholder')}
                      disabled={loadingMembers}
                      autoComplete="off"
                      style={{ fontSize: '0.85rem', padding: '4px 8px', width: 220 }}
                      onChange={(e) => {
                        setChangingDesigneeQuery(e.target.value);
                        setChangingDesigneeUserId('');
                        setChangingDesigneeDropdownOpen(true);
                      }}
                      onFocus={() => setChangingDesigneeDropdownOpen(true)}
                    />
                    {changingDesigneeDropdownOpen && !loadingMembers && (
                      <ul style={{
                        position: 'absolute', bottom: '100%', left: 0, right: 0,
                        background: 'var(--bg-modal)', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-lg)',
                        margin: 0, padding: 0, listStyle: 'none',
                        maxHeight: 220, overflowY: 'auto', zIndex: 9999,
                      }}>
                        {teamMembers.filter((u) => {
                          const q = changingDesigneeQuery.toLowerCase();
                          if (!q) return true;
                          return (
                            u.name.toLowerCase().includes(q) ||
                            u.loginid.toLowerCase().includes(q) ||
                            (u.mail ?? '').toLowerCase().includes(q) ||
                            (u.deptname ?? '').toLowerCase().includes(q)
                          );
                        }).length === 0 ? (
                          <li style={{ padding: '8px 12px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            {t('approval.no_search_results')}
                          </li>
                        ) : (
                          teamMembers.filter((u) => {
                            const q = changingDesigneeQuery.toLowerCase();
                            if (!q) return true;
                            return (
                              u.name.toLowerCase().includes(q) ||
                              u.loginid.toLowerCase().includes(q) ||
                              (u.mail ?? '').toLowerCase().includes(q) ||
                              (u.deptname ?? '').toLowerCase().includes(q)
                            );
                          }).map((u) => (
                            <li
                              key={u.loginid}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setChangingDesigneeQuery(u.name);
                                setChangingDesigneeUserId(u.loginid);
                                setChangingDesigneeDropdownOpen(false);
                              }}
                              style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)'; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                            >
                              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{u.name}</span>
                              <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.75rem' }}>
                                {u.loginid}{u.mail ? ` · ${u.mail}` : ''}{u.deptname ? ` · ${u.deptname}` : ''}
                              </span>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!changingDesigneeUserId || processing || loadingMembers}
                    onClick={handleChangeDesignee}
                  >
                    {t('approval.change')}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setChangingDesigneeOpen(false);
                      setChangingDesigneeUserId('');
                      setChangingDesigneeQuery('');
                      setChangingDesigneeDropdownOpen(false);
                      setTeamMembers([]);
                    }}
                  >
                    {t('common.cancel')}
                  </button>
                </>
              )}
              {/* 담당자 지정 (R·P 단계) */}
              {assignableStep && !assigningOpen && !changingDesigneeOpen && (
                <button
                  className="btn btn-secondary"
                  data-tour={isTourMode ? 'assign-btn' : undefined}
                  disabled={processing}
                  onClick={async () => {
                    setAssigningOpen(true);
                    setAssigningUserId('');
                    setAssigningReviewerId('');
                    setAssignReviewerDropdownOpen(false);
                    setLoadingMembers(true);
                    const members = await handleLoadTeamMembers(assignableStep.agent);
                    setTeamMembers(members);
                    setLoadingMembers(false);
                  }}
                >
                  {t('approval.assign_btn')}
                </button>
              )}
              {/* 검토중(claim) — J/O/E 단계 선점 */}
              {claimableStep && !assigningOpen && !changingDesigneeOpen && (
                <button
                  className="btn btn-secondary"
                  disabled={processing}
                  onClick={() => handleClaim(claimableStep.agent)}
                >
                  {t('approval.claim')}
                </button>
              )}
              {/* 검토중(claim) 취소 — 내가 선점한 단계를 다시 대기중으로 되돌린다 */}
              {unclaimableStep && !assigningOpen && !changingDesigneeOpen && (
                <button
                  className="btn btn-secondary"
                  disabled={processing}
                  onClick={() => handleUnclaim(unclaimableStep.agent)}
                >
                  {t('approval.unclaim')}
                </button>
              )}
              {/* 단일 담당자 지정 (R·P) */}
              {assignableStep && assigningOpen && (
                <>
                  <div className="assign-dropdown" style={{ position: 'relative' }}>
                    <button
                      type="button"
                      data-tour={isTourMode ? 'assign-select' : undefined}
                      className="btn btn-secondary btn-sm"
                      onClick={() => setAssignDropdownOpen((o) => !o)}
                      style={{ minWidth: 130, display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}
                    >
                      {assigningUserId ? (
                        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.3 }}>
                          <span style={{ fontWeight: 600 }}>{teamMembers.find((u) => u.loginid === assigningUserId)?.name}</span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{teamMembers.find((u) => u.loginid === assigningUserId)?.deptname}</span>
                        </span>
                      ) : (
                        <span>{t('approval.assign_select_placeholder')}</span>
                      )}
                      <span aria-hidden="true">▾</span>
                    </button>
                    {assignDropdownOpen && (
                      <ul className="assign-dropdown-list">
                        {loadingMembers ? (
                          <li className="assign-dropdown-empty">{t('common.loading')}</li>
                        ) : teamMembers.length === 0 ? (
                          <li className="assign-dropdown-empty">{t('approval.no_team_members')}</li>
                        ) : teamMembers.map((u, i) => (
                          <li
                            key={u.loginid}
                            data-tour={isTourMode && i === 0 ? 'assign-option' : undefined}
                            className="assign-dropdown-item"
                            onClick={() => {
                              setAssigningUserId(u.loginid);
                              setAssignDropdownOpen(false);
                              // 담당자 = 기존 검토자면 검토자 해제(둘은 서로 달라야 함)
                              if (assigningReviewerId === u.loginid) setAssigningReviewerId('');
                            }}
                          >
                            <strong>{u.name}</strong>
                            <span className="assign-dropdown-dept">{u.mail}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {/* R(RFG) 단계: 검토자 선택 (담당자 지정과 동일한 드롭다운 — '검토자 없음' 가능, 담당자와 달라야 함) */}
                  {assignableStep.agent === 'R' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div className="assign-dropdown" style={{ position: 'relative' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setAssignReviewerDropdownOpen((o) => !o)}
                          style={{ minWidth: 130, display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}
                        >
                          {assigningReviewerId ? (
                            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.3 }}>
                              <span style={{ fontWeight: 600 }}>{teamMembers.find((u) => u.loginid === assigningReviewerId)?.name}</span>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{teamMembers.find((u) => u.loginid === assigningReviewerId)?.deptname}</span>
                            </span>
                          ) : (
                            <span>{t('approval.assign_reviewer_none')}</span>
                          )}
                          <span aria-hidden="true">▾</span>
                        </button>
                        {assignReviewerDropdownOpen && (
                          <ul className="assign-dropdown-list">
                            <li
                              className="assign-dropdown-item"
                              onClick={() => { setAssigningReviewerId(''); setAssignReviewerDropdownOpen(false); }}
                            >
                              <strong>{t('approval.assign_reviewer_none')}</strong>
                            </li>
                            {teamMembers.filter((u) => u.loginid !== assigningUserId).map((u) => (
                              <li
                                key={u.loginid}
                                className="assign-dropdown-item"
                                onClick={() => { setAssigningReviewerId(u.loginid); setAssignReviewerDropdownOpen(false); }}
                              >
                                <strong>{u.name}</strong>
                                <span className="assign-dropdown-dept">{u.mail}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                  <button
                    data-tour={isTourMode ? 'assign-confirm' : undefined}
                    className="btn btn-primary btn-sm"
                    disabled={!assigningUserId || processing || loadingMembers}
                    onClick={() => {
                      const user = teamMembers.find((u) => u.loginid === assigningUserId);
                      if (user) {
                        handleAssign(assignableStep.agent, user.loginid, user.name, assignableStep.agent === 'R' ? assigningReviewerId : undefined);
                        setAssigningOpen(false);
                        setAssigningUserId('');
                        setAssigningReviewerId('');
                        setAssignDropdownOpen(false);
                        setAssignReviewerDropdownOpen(false);
                      }
                    }}
                  >
                    {t('common.confirm')}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setAssigningOpen(false); setAssigningUserId(''); setAssigningReviewerId(''); setAssignDropdownOpen(false); setAssignReviewerDropdownOpen(false); }}
                  >
                    {t('common.cancel')}
                  </button>
                </>
              )}
              {/* PL 검토 단계 액션 */}
              {actableStep && isPLStep && selected && (
                <>
                  <button className="btn btn-primary" disabled={processing} onClick={() => triggerAgree(actableStep.agent, true)}>
                    {t('approval.agree')}
                  </button>
                  <button className="btn btn-danger" disabled={processing} onClick={() => triggerReject(actableStep.agent, true)}>
                    {t('approval.reject')}
                  </button>
                  <button className="btn btn-secondary" disabled={processing} onClick={() => handlePeerSubmitNav(selected)}>
                    {t('approval.peer_submit')}
                  </button>
                </>
              )}
              {/* 영업/기술지원 합의자 단계 액션 — '수정 후 상신'은 PL 전용이라 여기엔 없다 */}
              {actableStep && isSalesAgreerStep && (
                <>
                  <button className="btn btn-primary" disabled={processing} onClick={() => triggerAgree(actableStep.agent, false, true)}>
                    {t('approval.agree')}
                  </button>
                  <button className="btn btn-danger" disabled={processing} onClick={() => triggerReject(actableStep.agent, false, true)}>
                    {t('approval.reject')}
                  </button>
                </>
              )}
              {/* 일반 단계 액션 */}
              {actableStep && !isPLStep && !isSalesAgreerStep && (
                <>
                  {/* 검토자 선택 (P/E 담당자 본인 — R 담당자지정 드롭다운과 동일한 스타일).
                      드롭다운에서 이름을 클릭하면 바로 추가되고, '합의'를 누르면 그 순간 선택된
                      검토자 지정 + 담당자 합의가 한 번의 요청으로 함께 처리된다. */}
                  {reviewerPickStep && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {reviewerSelectedIds.map((lid) => {
                        const u = reviewerCandidates.find((c) => c.loginid === lid);
                        return (
                          <span
                            key={lid}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: '0.82rem' }}
                          >
                            {u?.name ?? lid}
                            <button
                              type="button"
                              onClick={() => setReviewerSelectedIds((prev) => prev.filter((x) => x !== lid))}
                              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1, padding: 0 }}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                      <div className="assign-dropdown" style={{ position: 'relative' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={processing}
                          onClick={async () => {
                            if (!reviewerDropdownOpen && reviewerCandidates.length === 0 && !loadingMembers) {
                              setLoadingMembers(true);
                              const members = await handleLoadTeamMembers(reviewerPickStep.agent);
                              setReviewerCandidates(members);
                              setLoadingMembers(false);
                            }
                            setReviewerDropdownOpen((o) => !o);
                          }}
                          style={{ minWidth: 110, display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}
                        >
                          <span>{t('approval.assign_reviewer_select_placeholder')}</span>
                          <span aria-hidden="true">▾</span>
                        </button>
                        {reviewerDropdownOpen && (
                          <ul className="assign-dropdown-list">
                            {loadingMembers ? (
                              <li className="assign-dropdown-empty">{t('common.loading')}</li>
                            ) : (() => {
                              const options = reviewerCandidates.filter((u) =>
                                u.loginid !== reviewerPickStep.assignee_loginid &&
                                !existingReviewerLoginids.includes(u.loginid) &&
                                !reviewerSelectedIds.includes(u.loginid)
                              );
                              return options.length === 0 ? (
                                <li className="assign-dropdown-empty">{t('approval.no_team_members')}</li>
                              ) : options.map((u) => (
                                <li
                                  key={u.loginid}
                                  className="assign-dropdown-item"
                                  onClick={() => {
                                    setReviewerSelectedIds((prev) => [...prev, u.loginid]);
                                    setReviewerDropdownOpen(false);
                                  }}
                                >
                                  <strong>{u.name}</strong>
                                  <span className="assign-dropdown-dept">{u.mail}</span>
                                </li>
                              ));
                            })()}
                          </ul>
                        )}
                      </div>
                      {needsReviewerPick && (
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {t('approval.reviewer_required_hint')}
                        </span>
                      )}
                    </div>
                  )}
                  <button
                    className="btn btn-primary"
                    disabled={processing || needsReviewerPick}
                    onClick={() => triggerAgree(actableStep.agent)}
                  >
                    {t('approval.agree')}
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={processing}
                    onClick={() => triggerReject(actableStep.agent)}
                  >
                    {actableStep.agent === 'E' || actableStep.agent === 'EV'
                      ? t('approval.request_revision')
                      : t('approval.reject')}
                  </button>
                </>
              )}
              <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>
                {t('common.close')}
              </button>
            </div>
          );
        })()}
      >
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <StatusBadge status={selected.status} />

            {/* 중단 요청/확정 배너 */}
            {selected.pause_request && (
              <div className="pause-banner">
                <div style={{ fontSize: '1.2rem', lineHeight: 1.2 }} aria-hidden="true">⏸</div>
                <div style={{ flex: 1 }}>
                  <p className="pause-banner-title">
                    {selected.status === 'pause'
                      ? t('approval.pause_banner_paused')
                      : t('approval.pause_banner_requested', { name: selected.pause_request.requester_name })}
                  </p>
                  <p className="pause-banner-reason">“{selected.pause_request.reason}”</p>
                  {selected.pause_request.state === 'requested' ? (
                    <>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                        {t('approval.pause_confirm_status')}
                      </div>
                      <div className="pause-confirm-track">
                        {(selected.approval_steps ?? [])
                          .filter((s) => selected.pause_request!.target_step_ids.includes(s.id))
                          .map((s) => {
                            const done = selected.pause_request!.confirmed_step_ids.includes(s.id);
                            const mine = !done && s.action === 'pending' && canConfirmPauseStep(currentUser, s);
                            const label = t(`approval.agent_${s.agent}` as any);
                            return (
                              <span key={s.id} className={`pause-cf ${done ? 'done' : mine ? 'mine' : ''}`}>
                                <span className="pause-cf-dot" aria-hidden="true" />
                                {label} · {done ? t('approval.pause_cf_done') : mine ? t('approval.pause_cf_mine') : t('approval.pause_cf_wait')}
                              </span>
                            );
                          })}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {t('approval.pause_resume_hint')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 철회 요청 배너 — 확인 현황과 '확정 시 삭제' 경고를 함께 보여준다 */}
            {selected.withdraw_request && (
              <div className="pause-banner withdraw-banner">
                <div style={{ fontSize: '1.2rem', lineHeight: 1.2 }} aria-hidden="true">🗑️</div>
                <div style={{ flex: 1 }}>
                  <p className="pause-banner-title">
                    {t('approval.withdraw_banner_requested', { name: selected.withdraw_request.requester_name })}
                  </p>
                  <p className="pause-banner-reason">“{selected.withdraw_request.reason}”</p>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 6 }}>
                    ⚠️ {t('approval.withdraw_banner_warning')}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                    {t('approval.withdraw_confirm_status')}
                  </div>
                  <div className="pause-confirm-track">
                    {(selected.approval_steps ?? [])
                      .filter((s) => selected.withdraw_request!.target_step_ids.includes(s.id))
                      .map((s) => {
                        const done = selected.withdraw_request!.confirmed_step_ids.includes(s.id);
                        const mine = !done && s.action === 'pending' && canConfirmPauseStep(currentUser, s);
                        const label = t(`approval.agent_${s.agent}` as any);
                        return (
                          <span key={s.id} className={`pause-cf ${done ? 'done' : mine ? 'mine' : ''}`}>
                            <span className="pause-cf-dot" aria-hidden="true" />
                            {label} · {done ? t('approval.pause_cf_done') : mine ? t('approval.pause_cf_mine') : t('approval.pause_cf_wait')}
                          </span>
                        );
                      })}
                  </div>
                </div>
              </div>
            )}

            {/* 페이지 네비게이션 + 의뢰 상세 */}
            <PagedDetailView
              ref={pagedDetailViewRef}
              doc={selected}
              role={isTourMode ? 'MASTER' : (currentUser.role as UserRole)}
              pageIdx={pageIdx}
              setPageIdx={setPageIdx}
              canEditValidationSystem={canEditValidationSystem(selected)}
              onValidationSystemChange={handleValidationSystemChange}
              reviewItems={buildReviewItemsProps(selected)}
              canUseJayerFilter={canUseLayerFilter(selected, 'J')}
              canUseOayerFilter={canUseLayerFilter(selected, 'O')}
              jayerLayerFilterSets={jayerLayerFilterSets}
              oayerLayerFilterSets={oayerLayerFilterSets}
              onApplyJayerLayerFilter={(filterId) => handleApplyLayerFilter('J', filterId)}
              onApplyOayerLayerFilter={(filterId) => handleApplyLayerFilter('O', filterId)}
              onOpenJayerFilterManage={() => setJayerFilterManageOpen(true)}
              onOpenOayerFilterManage={() => setOayerFilterManageOpen(true)}
            />
          </div>
        )}
      </Modal>

      {/* J-layer 공유 필터 관리 — TE_J/MASTER 전원이 같은 목록을 본다 */}
      <FilterManageModal
        isOpen={jayerFilterManageOpen}
        onClose={() => { setJayerFilterManageOpen(false); setJayerFilterNewDraft({ label: '', words: emptyDraftWords() }); }}
        title={t('request.jayer_filter_manage')}
        filterSets={jayerLayerFilterSets.map((fs) => ({ id: String(fs.id), label: fs.label, words: fs.words }))}
        newFilter={jayerFilterNewDraft}
        setNewFilter={setJayerFilterNewDraft}
        onAllDelete={() => setLayerFilterAllDeleteConfirm('J')}
        onRequestDelete={(fs) => setLayerFilterDeleteConfirm({ table: 'J', id: Number(fs.id), label: fs.label })}
        onAdd={async (label, words) => {
          const created = await layerFilterSetsAPI.create('J', label, words);
          setJayerLayerFilterSets((prev) => [...prev, created]);
        }}
        onEdit={async (filterId, label, words) => {
          const updated = await layerFilterSetsAPI.update(Number(filterId), label, words);
          setJayerLayerFilterSets((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
        }}
      />

      {/* O-layer 공유 필터 관리 — TE_O/MASTER 전원이 같은 목록을 본다 */}
      <FilterManageModal
        isOpen={oayerFilterManageOpen}
        onClose={() => { setOayerFilterManageOpen(false); setOayerFilterNewDraft({ label: '', words: emptyDraftWords() }); }}
        title={t('request.oayer_filter_manage')}
        filterSets={oayerLayerFilterSets.map((fs) => ({ id: String(fs.id), label: fs.label, words: fs.words }))}
        newFilter={oayerFilterNewDraft}
        setNewFilter={setOayerFilterNewDraft}
        onAllDelete={() => setLayerFilterAllDeleteConfirm('O')}
        onRequestDelete={(fs) => setLayerFilterDeleteConfirm({ table: 'O', id: Number(fs.id), label: fs.label })}
        onAdd={async (label, words) => {
          const created = await layerFilterSetsAPI.create('O', label, words);
          setOayerLayerFilterSets((prev) => [...prev, created]);
        }}
        onEdit={async (filterId, label, words) => {
          const updated = await layerFilterSetsAPI.update(Number(filterId), label, words);
          setOayerLayerFilterSets((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
        }}
      />

      <ConfirmModal
        isOpen={!!layerFilterDeleteConfirm}
        onClose={() => setLayerFilterDeleteConfirm(null)}
        onConfirm={async () => {
          if (!layerFilterDeleteConfirm) return;
          const { table, id } = layerFilterDeleteConfirm;
          await layerFilterSetsAPI.delete(id);
          (table === 'J' ? setJayerLayerFilterSets : setOayerLayerFilterSets)((prev) => prev.filter((f) => f.id !== id));
          setLayerFilterDeleteConfirm(null);
        }}
        title={t('common.confirm')}
        message={t('request.filter_delete_confirm', { label: layerFilterDeleteConfirm?.label ?? '' })}
        confirmLabel={t('common.delete')}
        danger
        topLevel
      />

      <ConfirmModal
        isOpen={!!layerFilterAllDeleteConfirm}
        onClose={() => setLayerFilterAllDeleteConfirm(null)}
        onConfirm={async () => {
          const table = layerFilterAllDeleteConfirm;
          if (!table) return;
          const sets = table === 'J' ? jayerLayerFilterSets : oayerLayerFilterSets;
          await Promise.all(sets.map((fs) => layerFilterSetsAPI.delete(fs.id)));
          (table === 'J' ? setJayerLayerFilterSets : setOayerLayerFilterSets)([]);
          setLayerFilterAllDeleteConfirm(null);
        }}
        title={t('common.confirm')}
        message={t('request.filter_all_delete_confirm')}
        confirmLabel={t('common.delete')}
        danger
        topLevel
      />

      <StepGuideTour
        isOpen={shareTourOpen}
        title={t('approval.title')}
        groups={shareTourGroups}
        onRestoreBase={restoreShareTourBase}
        onClose={() => setShareTourOpen(false)}
      />

      {/* 전체 가이드 데모: 제목을 실제로 클릭하는 모습을 보여주는 가짜 커서 */}
      {isTourMode && tourCursor && (
        <div className={`tour-jcursor${tourClicking ? ' clicking' : ''}`} style={{ transform: `translate(${tourCursor.x}px, ${tourCursor.y}px)` }}>
          {tourClicking && <span className="tour-jcursor-ripple" />}
          <svg width="22" height="22" viewBox="0 0 22 22">
            <path d="M2 2 L2 17 L6.2 13 L9 19 L11.4 18 L8.6 12 L14 12 Z" fill="#fff" stroke="#1a1a2e" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
  );
}
