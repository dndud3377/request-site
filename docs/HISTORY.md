# HISTORY — 이력 조회

결재가 끝난 의뢰서와 반려 이력을 조회하는 화면.

- 화면: `frontend/src/pages/HistoryPage.tsx`
- 경로: `/history` (`App.tsx` — `ProtectedRoute`)
- 상세 모달: `frontend/src/components/PagedDetailView.tsx` (결재 현황과 공용, 읽기 전용)

---

## 1. 필터 탭

| 탭 | 키 | 대상 | 조건 |
|---|---|---|---|
| 전체 | `''` | 결재 완료 문서 | `status='approved'` 전부 |
| MY | `my` | 결재 완료 문서 | 내가 의뢰자이거나, 결재 단계 담당자였던 문서 |
| 라인1~라인5, nv | `line_<값>` | 결재 완료 문서 | `additional_notes.detail.line` 이 그 값 |
| 반려 | `rejected` | 반려 이력 | 반려 스냅샷 전부 |

- 라인 탭 목록은 **라인 마스터**(`GET /api/lines/`)에서 받는다 — 의뢰서 작성 화면과 같은 출처라
  마스터에 라인이 추가되면 탭도 함께 늘어난다. 조회 전이거나 응답이 비었을 때만
  `RequestPage/constants.ts` 의 `OPTION_LINE` 을 폴백으로 쓴다.
- 탭 라벨은 `history.filter_line_*` 키가 **있으면 번역문**, 없으면 **마스터의 라인 이름 그대로**다
  (`lineLabel`). 키 존재 여부를 확인하지 않으면 i18next 가 없는 키를 그대로 반환해
  `history.filter_line_…` 원문이 탭에 노출되므로, `i18n.exists()` 확인을 빼면 안 된다.
  새 라인의 번역이 필요하면 `LINE_I18N_SUFFIX` 와 ko/en 키를 함께 추가한다.
- 라인 분류는 **제목 파싱이 아니라 원본값**(`detail.line`)을 본다. 제목 포맷이 바뀌어도 깨지지 않는다.
- **반려 문서는 반려 탭에만** 나온다. 전체·MY·라인 탭은 결재 완료 문서만 다루므로 서로 겹치지 않는다.
- 각 탭에는 결재 현황과 동일하게 건수 배지가 붙는다(0건이면 숫자 생략). 탭 줄은 결재 현황과
  같은 자리 — 검색창과 한 줄(`.toolbar` 안, `.search-box` 다음)에 놓인다.
- 탭 전환은 클라이언트 필터라 API 를 다시 호출하지 않는다. 검색어는 탭을 바꿔도 유지된다.

### MY 탭이 결재 현황과 다른 점
결재 현황의 MY 는 "내가 지금 처리해야 할 **pending** 단계가 있는 문서"다. 이력 조회는 결재가 끝난
문서를 다루므로 pending 단계가 없다. 그래서 여기서는 합의·반려 여부를 가리지 않고 **관여 이력**
(의뢰자 본인 또는 `approval_steps.assignee_loginid` 일치)으로 판정한다. 역할과 무관하게 동작하므로
PL 이 아닌 사용자도 자기가 참여했던 의뢰서를 볼 수 있다.

---

## 2. 목록 표

컬럼: `번호 / 제목 / 제품명 / 의뢰자 / 상태 / 상신일 / 결재 완료일`

- '번호'는 문서 ID 가 아니라 화면상의 행 번호다.
- '결재 완료일'은 `approval_steps` 중 `action='approved'` 인 단계의 가장 늦은 `acted_at`.
- **반려 탭에서만** 마지막 컬럼이 '반려일'(`rejected_at`)로 바뀐다. 나머지 컬럼 구성은 동일하다.
- MASTER 에게만 맨 오른쪽에 삭제 열이 보인다. 반려 탭에서는 **반려 이력 1행**을 지우며,
  원본 문서는 그대로 남는다.
- `role='NONE'` 사용자는 제목을 클릭할 수 없다(상세 모달 미노출). 반려 탭도 동일하다.

---

## 3. 상세 모달

- **결재 완료 문서**: 행 클릭 시 `GET /api/documents/{id}/` 로 상세를 한 번 더 받아 연다
  (목록 응답에는 검토 항목이 없기 때문). 실패하면 목록 행 데이터로 그대로 연다.
- **반려 이력**: 추가 API 호출 없이, 이미 받아둔 스냅샷을 문서 모양으로 변환해서 연다.
  상세·표는 `additional_notes` 스냅샷, 결재 경로 탭은 스냅샷의 `approval_steps` 를 쓰므로
  **재상신으로 원본이 바뀌어도 반려 당시 화면이 그대로 유지된다.**
- 검토 항목(J-ayer 서브탭)은 결재 완료 문서에서만, TE_J·MASTER 에게만, 항목이 있을 때만 노출되며
  **완전 읽기 전용**이다(편집·확인 모두 닫힘). 반려 스냅샷에는 검토 항목이 없어 노출되지 않는다.

---

## 4. 반려 이력 (RejectionSnapshot)

### 왜 별도 테이블인가
반려는 문서의 `status` 만 `rejected` 로 바꾸고, 재상신하면 같은 레코드가 `under_review` 로
되돌아간다. 그래서 문서만으로는 "언제 무슨 내용으로 반려됐는지"가 남지 않는다.
반려가 확정되는 순간 문서를 통째로 복사해 별도 테이블에 적재한다.

### 적재 규칙
- 적재 위치: `backend/api/rejection_snapshots.py` 의 `create_from_reject()`
- 호출 지점: `POST /api/documents/{id}/reject-step/`, `POST /api/documents/{id}/peer-reject/` (지정 PL 반려)
- **E/EV(MASK)의 '수정 요청'은 적재하지 않는다** — 문서 `status` 를 바꾸지 않는 별개 동작이다.
- 회차마다 1행씩 누적된다(3번 반려 = 3행). 첫 반려로 문서가 `rejected` 가 되면 이후 결재 액션은
  `_blocked_progress_response` 가 막으므로 같은 회차가 두 번 쌓이지 않는다.
- 원본 문서가 삭제돼도 이력은 남는다(`document` 는 `SET_NULL`, `source_document_id` 로 추적).
- **소급 적재는 하지 않는다.** 이 기능 배포 이전에 반려된 문서는 반려 탭에 나오지 않는다.

### 저장 필드 (`api_rejectionsnapshot`)
| 필드 | 설명 |
|---|---|
| `document` / `source_document_id` | 원본 문서 FK(삭제 시 NULL) / 원본 문서 id |
| `title`, `product_name`, `requester_name`, `requester_department`, `requester_loginid`, `submitted_at` | 목록 표시용 복사본 |
| `additional_notes` | 반려 시점 상세 폼·J/O/BB 표 전체 JSON |
| `approval_steps` | 반려 시점 결재 단계 전체 JSON (응답에서는 배열로 풀어서 내려간다) |
| `round` | 반려된 회차 |
| `rejected_at`, `rejected_agent`, `rejected_by_name`, `rejected_by_loginid`, `reject_comment` | 반려 메타 |

`rejected_by_*` 는 **버튼을 누른 사람**이다(MASTER 는 본인이 담당자가 아닌 단계도 반려할 수 있어
단계 담당자와 다를 수 있다).

---

## 4.5 이력 바로 등록 (MASTER — 결재 경로 없이 등록)

MASTER 는 의뢰서 작성 화면에서 결재를 전혀 거치지 않고 문서를 곧바로 이 화면에 올릴 수 있다.

- 진입: 의뢰서 작성 **step 5**, `상신하기` 왼쪽의 `📋 이력에 바로 등록` 버튼.
  노출 조건은 `role='MASTER'` **이면서** 결재선이 아직 없는 문서(신규 작성 또는 임시저장 재진입)다.
  반려 재상신·지정 PL 수정·재개(pause) 모드에서는 보이지 않는다.
- 모달에서 **상신일 / 결재 완료일**을 직접 입력한다(기본값 = 오늘).
- 검증은 상신과 동일하다 — 5단계 위저드 필수값 전체 + 서버측 Backbone 매핑 검증.
  **지정 PL·후결자·통보자만 요구하지 않는다**(결재선을 만들지 않으므로).

### 저장 결과

| 대상 | 값 |
|---|---|
| `RequestDocument.status` | `approved` |
| `RequestDocument.submitted_at` | 입력한 **상신일** (그 날 12:00 로컬) |
| `ApprovalStep` | **1행만** — `agent='PL'`, `action='approved'`, `acted_at`=입력한 **결재 완료일**, `assignee`=등록한 MASTER, `round=1` |
| 메일 | **발송 없음** (상신·단계 도착·완료 모두) |

- 이 `ApprovalStep` 1행은 결재를 시작시키는 대기 단계가 **아니다.** 결재 완료일을 저장할 수 있는 곳이
  `ApprovalStep.acted_at` 뿐이라 쓰는 자리이며, 처음부터 `action='approved'` 이므로 담당자 대기열·
  단계 전개(R→P→J→O→E)·단계 도착 메일이 어디에서도 발생하지 않는다.
- `status='approved'` 라서 결재 현황 목록에는 나타나지 않는다(`ApprovalPage.tsx` 가 `approved` 를 제외).
- **이력 목록·상세에서 일반 결재 완료 문서와 구분 표시하지 않는다.** 화면 코드도 바뀌지 않았다 —
  기존 계산식(`approval_steps` 중 `approved` 의 최신 `acted_at`)이 그대로 완료일을 찾아낸다.
- **날짜를 12:00 로 저장하는 이유**: 화면은 `utils/date.ts` 의 `toLocaleDateString` 으로 **브라우저
  로컬 시간대** 기준 변환을 한다. 00:00 로 저장하면 시간대가 다른 브라우저에서 하루 밀려 보인다.
- 제목 끝의 `_요청서_YYMMDD` 도 **입력한 상신일**을 따른다(오늘 날짜가 아니다).
- 마이그레이션은 없다. 기존 필드만 사용한다.

---

## 5. API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/documents/?status=approved&search=…` | 결재 완료 문서 목록 (전체/MY/라인 탭) |
| GET | `/api/documents/{id}/` | 상세(검토 항목 포함) |
| POST | `/api/documents/{id}/delete/` | 문서 삭제 (MASTER) |
| POST | `/api/documents/{id}/direct-approve/` | 이력 바로 등록 (**MASTER 만**, `draft` 만) — §4.5 |
| GET | `/api/rejection-snapshots/?search=…` | 반려 이력 목록 — `rejected_at` 최신순, 페이지네이션 없음 |
| GET | `/api/rejection-snapshots/{id}/` | 반려 이력 1건 |
| DELETE | `/api/rejection-snapshots/{id}/` | 반려 이력 삭제 (**MASTER 만**, 그 외 403) |

- 반려 이력의 검색 대상은 문서와 동일하게 `title / product_name / requester_name / requester_department`.
- 생성·수정 라우트는 없다(405). 적재는 반려 API 에서만 일어난다.
- 조회 권한은 이력 조회에 들어올 수 있는 사람 전원(`IsAuthenticatedOrMasterDelete`).

---

## 6. 메일 딥링크

`/history?id=<문서id>` 로 들어오면 그 문서를 조회해 상세 모달을 열고, 배경 목록도 그 제목으로
자동 검색된다. 이때 필터 탭은 검색과 충돌하지 않도록 '전체'로 리셋된다.
존재하지 않거나 접근할 수 없는 문서면 조용히 무시한다.

---

## 7. i18n 키

`history.*` — `filter_all`, `filter_my`, `filter_line_1`~`filter_line_5`, `filter_line_nv`,
`filter_rejected`, `search_placeholder`, `no_data`, `no_data_rejected`, `col_id`, `col_title`,
`col_product`, `col_type`, `col_requester`, `col_status`, `col_submitted`, `col_approved`,
`col_rejected`, `delete`, `delete_title`, `delete_confirm`, `delete_success`,
`delete_snapshot_title`, `delete_snapshot_confirm`, `delete_snapshot_success`

이력 바로 등록(§4.5)의 문구는 작성 화면 소속이라 `request.*` 에 있다 —
`direct_history`, `direct_history_register`, `direct_history_submitted_at`,
`direct_history_approved_at`, `direct_history_date_required`, `direct_history_date_order`,
`direct_history_success`

`ko.json` / `en.json` 에 같은 키가 있어야 한다.
