# VOC — 고객의 소리 페이지 (VOCPage)

> 작성일: 2026-08-12
> 목적: VOC 기능의 **실제 구현 동작**을 기록한다. 의도와 구현이 일치하는지 검증할 때
> 이 문서를 기준으로 확인한다. (⚠️ 표시는 "확인이 필요"하거나 "미사용"인 부분이다.)

- 프론트 라우트: `/voc`
- 진입 컴포넌트: `frontend/src/pages/VOCPage.tsx`
- 백엔드: `backend/api/views.py` (`VOCViewSet`), `backend/api/models.py`
- 본인 판정 헬퍼: `backend/api/doc_permissions.py` (`is_voc_submitter`)
- 메일: `backend/api/mailer.py` (`enqueue_voc_created` / `enqueue_voc_comment`)
- @멘션: `frontend/src/components/VocMentionList.tsx`(추천 목록) / `backend/api/views.py`(`_extract_voc_mentions`) / `VocMention` 모델

---

## 0. 기능 성격

VOC 는 **결재가 아니다.** 문의글을 올리면 누구나 답글을 달아 함께 의문점을 해소하고,
작성자(또는 MASTER)가 마무리하는 **토론형 게시판**이다.

- 반려 개념이 **없다.** 잘못 올린 글도 답변 완료로 마무리한다.
- 결재선·단계·승인 같은 개념이 없다.
- 상태는 `확인중` → `답변완료` 단방향뿐이며, 되돌리는 경로는 없다.

---

## 1. 데이터 모델

### 1.1 VOC
`backend/api/models.py:513~`

| 필드 | 의미 |
|------|------|
| `title` | 제목 |
| `category` | ⚠️ **미사용(2026-11-20 폐지).** 예전 유형 값(`inquiry`/`error_report`/`feature_request`/`task_request`). 기존 값 보존을 위해 컬럼만 남겼고(빈 값 허용), 화면·API 필터·메일에서 쓰지 않는다 |
| `submitter_role` | **등록 시점 작성자 팀(역할).** 등록 시 서버가 `request.user.role` 로 확정한다(읽기 전용, 프론트가 보낸 값 무시). 이후 작성자 역할이 바뀌어도 유지된다. 마이그레이션 0064 가 기존 VOC 를 작성자 계정의 **현재** 역할로 채웠다(계정 없음 → 빈 값 = 기타) |
| `submitter` | **제출자 FK(User).** 등록 시 서버가 `request.user` 로 확정한다 |
| `submitter_name` / `submitter_email` | 제출자 표시용 비정규화 값(프론트가 보낸 값) |
| `page` | ⚠️ **미사용(2026-11-20 폐지).** 예전 관련 페이지 값. 컬럼만 남겼다 |
| `content` | 내용. RichTextEditor 가 만든 **HTML** |
| `status` | `checking`(확인중) / `completed`(완료). 기본값 `checking` |
| `created_at` | 접수일 |
| `responded_at` | 답변 완료 처리 시각. `update-status` 에서 기록한다 |
| `response` | ⚠️ **미사용.** 어디서도 값을 채우지 않는다 |

> 소유자 식별은 의뢰서(`RequestDocument.requester`)와 **동일한 방식**을 따른다.
> FK 가 진실의 원천이고, 본인 판정은 `id` 가 아니라 `loginid` 로 한다(§3.1 참조).

### 1.2 VocComment (답글)
`backend/api/models.py:552~`. VOC 에 FK(`related_name='comments'`, CASCADE).

| 필드 | 의미 |
|------|------|
| `author_name` / `author_role` | 작성자 이름 / 역할 |
| `author_email` | 서버가 `request.user.mail` 로 채운다(메일 수신자 산출에 사용) |
| `is_submitter` | 제출자 본인의 답글 여부 |
| `content` | 내용. `RichTextEditor` 가 만든 **HTML** (2026-08-18 이전에는 평문이었다 — §7 참조) |
| `created_at` | 작성일시. 정렬 기준(오름차순) |

### 1.3 VocMention (@멘션 태그, 2026-11-23)
`backend/api/models.py` `VocMention`. VOC 에 FK(`related_name='mentions'`, CASCADE). 마이그레이션 0067.

| 필드 | 의미 |
|------|------|
| `team` | 태그된 팀 역할 코드(`TE_R`/`TE_P`/`TE_J`/`TE_O`/`TE_E` — `VocMention.TEAM_ROLES`). 사용자 태그면 빈 값 |
| `user` | 태그된 사용자 FK. 팀 태그면 `null` |
| `created_at` | 태그일시 |

- 등록 본문(`POST /api/voc/`)과 답글(`POST /api/voc/{id}/comment/`)을 저장할 때 서버가 **저장되는 HTML 의 멘션 표식**
  `<span data-type="mention" data-id="team:TE_R">` / `data-id="user:<loginid>"` 을 직접 읽어 누적한다(`views._extract_voc_mentions`).
  프론트가 따로 보낸 목록은 없다.
- 받는 대상: 태그할 수 있는 팀(AGENT 5팀)과 **권한이 부여된 실제 계정**(`role != NONE`)뿐. 제품 담당자·관리자 팀, 없는 계정, 미지정 계정은 버린다.
- 같은 대상을 다시 태그해도 행이 늘지 않고(`get_or_create`), **한 번 태그되면 지우지 않는다**.
- ⚠️ MASTER 전용 수정 API(`PUT/PATCH /api/voc/{id}/`, 화면 없음)로 본문을 고쳐도 멘션은 다시 읽지 않는다.

### 1.4 VocHistory
`backend/api/models.py:885~`

> ⚠️ **완전 미사용 모델이다.** 레코드를 생성하는 코드가 백엔드·프론트 어디에도 없고,
> 프론트에 대응 타입도 없다. API(`/api/voc-histories/`)는 살아 있으나 항상 빈 목록을 준다.

---

## 2. API

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| GET | `/api/voc/` | 목록. 페이지네이션 없음(전체 반환), 정렬 `-created_at` |
| POST | `/api/voc/` | 등록. `submitter` 는 서버가 확정하므로 보내지 않는다 |
| GET | `/api/voc/{id}/` | 단건 |
| PUT / PATCH | `/api/voc/{id}/` | 수정. **MASTER 전용**(`VOCViewSet.update` — 그 외 403 `관리자만 VOC 를 수정할 수 있습니다.`, 2026-11-20). 화면에는 수정 기능이 없다. `status`·`submitter` 등 읽기 전용 필드는 MASTER 도 바꿀 수 없다 |
| DELETE | `/api/voc/{id}/` | 삭제. **MASTER 전용** (`IsAuthenticatedOrMasterDelete`) |
| PATCH | `/api/voc/{id}/update-status/` | 상태 변경. `completed` 로만 가능 |
| POST | `/api/voc/{id}/comment/` | 답글 등록. 응답은 VOC 전체(댓글 포함) |

### 2.1 목록 쿼리 파라미터

| 파라미터 | 의미 |
|---------|------|
| `mine=true` | 로그인 사용자가 등록한 VOC + **@멘션으로 나를 직접 태그한 VOC**(2026-11-23). 팀 태그만으로는 들어가지 않는다. **사용자 id 를 보내지 않는다**(§3.1) |
| `team` | 작성자 팀 필터(`submitter_role`). `PL`/`TE_R`/`TE_P`/`TE_J`/`TE_O`/`TE_E` 는 그 팀이 쓴 VOC + **그 팀이 @멘션으로 태그된 VOC**(2026-11-23), `etc` 는 작성자 팀이 그 외 전부(관리자·미지정·해외 제품 담당자·빈 값). 알 수 없는 값은 빈 목록. 기준 목록은 `VOC.TEAM_FILTER_ROLES` (2026-11-20, 유형 필터 `category` 대체) |
| `status` | 상태 필터 |
| `search` | `title` / `submitter_name` / `content` 검색 |

### 2.2 응답 필드 (VOCSerializer)

모델 필드 전체에 더해 아래를 내려준다.

| 필드 | 의미 |
|------|------|
| `comments` | 답글 목록(읽기 전용) |
| `submitter_loginid` | 제출자 계정의 loginid. **프론트의 "내 VOC" 판정 기준** |

`created_at` / `responded_at` / `status` / `submitter` 는 읽기 전용이다.
`status` 와 `responded_at` 은 `update-status` 액션으로만 바뀐다.

---

## 3. 권한

### 3.1 본인 판정은 loginid 로 한다 (중요)

`doc_permissions.is_voc_submitter(user, voc)` 는 `voc.submitter.loginid` 와
`user.loginid` 를 비교한다. **`user.id` 를 직접 비교하지 않는다.**

이유: 개발 모드(`AUTH_MODE=dev`)의 프론트는 `AuthContext` 의 하드코딩된 목 사용자
목록(`MOCK_USERS`)을 화면 상태로 쓰기 때문에, `currentUser.id` 가 DB 의 실제
`user.id` 와 어긋날 수 있다. 반면 `loginid` 는 dev 로그인이 계정을 조회하는 키라
(`auth_views_dev.py`) 어긋나지 않는다.

같은 이유로 프론트의 "내 VOC" 판정도 `submitter_loginid === currentUser.username`
으로 하며, 목록 필터도 id 를 보내지 않고 `mine=true` 로 서버에 위임한다.

### 3.2 동작별 권한

| 동작 | 권한 |
|------|------|
| 조회 | 운영=인증 필요 / 개발=허용 |
| 등록 | 위와 동일. `submitter` 는 인증된 사용자로 확정(비인증이면 `null`) |
| 답글 | **누구나.** 제한 없음 |
| 답변 완료 | **작성자 본인 또는 MASTER** |
| 수정(PUT/PATCH `/api/voc/{id}/`) | **MASTER 전용** — 작성자 본인도 불가(2026-11-20). 이전에는 권한 클래스가 DELETE 만 막아 로그인 사용자 누구나 남의 VOC 제목·내용을 고칠 수 있었다. 공용 `IsAuthenticatedOrMasterDelete` 는 다른 ViewSet 도 쓰므로 `VOCViewSet.update` 에서만 막는다 |
| 삭제 | **MASTER 전용** |

> 답변 완료를 시도한 사람이 작성자도 MASTER 도 아니면 403
> (`작성자 본인 또는 관리자만 완료 처리할 수 있습니다.`).
> `completed` 이외의 상태로 바꾸려 하면 400 (`유효하지 않은 상태입니다.`).

---

## 4. 화면 흐름

### 4.1 목록
헤더(+ VOC 등록 버튼) → 필터 탭(전체 / 내 VOC / 팀 7개: 제품 담당자·AGENT R·P·J·O·E팀·기타 / 상태 2개: 확인중·답변완료) + 검색창 →
테이블(No. / 제목 / 작성자 팀 / 제출자 / 상태 / 접수일) → 페이지네이션

- **팀 필터(2026-11-20)**: 팀 탭은 서버의 `team` 쿼리 파라미터로 위임한다(§2.1). '기타'에는 관리자·미지정·해외 제품 담당자,
  작성자 계정이 없던 옛 VOC 가 들어간다. 팀 이름은 권한 라벨(`common.role_label_*`)을 그대로 쓴다.
  2026-11-23부터 팀 탭에는 그 팀이 @멘션으로 태그된 VOC 도 보인다(예: 제품 담당자 VOC 에 R팀 태그 → '제품 담당자'·'AGENT R팀' 탭 모두).
  목록의 '작성자 팀' 컬럼은 그대로 등록 시점 작성자 팀이다.

- 제목을 클릭하면 상세 모달이 열린다.
- `?id=123` 쿼리로 진입하면 해당 VOC 상세가 자동으로 열린다(메일 딥링크용). 목록이 여러 페이지로
  나뉘어도 검색은 필터링된 전체 목록(`vocs`) 기준이라 페이지에 상관없이 찾아 연다.
- **페이지네이션**: 결재 현황(`ApprovalPage`)과 동일하게 클라이언트에서 페이지당 10건씩 자른다
  (`VOC_LIST_PAGE_SIZE`). 목록 API 자체는 여전히 전체를 반환한다(§2.1). 필터 탭·검색어가 바뀌면
  1페이지로 초기화된다.
- **상태 필터**: '확인중' / '답변완료' 탭은 서버의 `status` 쿼리 파라미터로 위임한다(§2.1). 다른
  탭과 마찬가지로 단일 선택이라 '내 VOC'·팀과 동시에 조합할 수 없다(§7).

### 4.2 등록 모달
제목(필수) / 내용(필수, RichTextEditor). 유형·페이지 선택은 2026-11-20 폐지했다(제대로 선택되지 않아 의미가 없었다).

- 모달 헤더 오른쪽에 `작성자 팀: {팀}` 배지를 보여 준다 — 화면의 현재 로그인 사용자 권한(`currentUser.role`).
  저장값은 서버가 등록 시점 역할로 확정하므로, 개발 모드에서 사용자를 전환한 직후에는 일시적으로 다를 수 있다.

- 내용은 태그를 걷어낸 평문이 비어 있으면 등록을 막는다.
- **@멘션(2026-11-23)**: 본문에서 `@` 를 치면 추천 목록이 뜬다(§4.4). 태그한 팀·사용자는 등록 메일을 받는다(§5.1).
- 입력칸 높이는 `RichTextEditor` 의 `EDITOR_MIN_HEIGHT`(240px)를 따른다.

### 4.3 상세 모달
메타 정보(작성자 팀 / 상태 / 접수일·제출자) → 원본 내용(HTML 렌더) → 답글 목록 → 답글 입력

- **렌더 정화(2026-11-20, B-26)**: 본문·답글 HTML 은 `sanitizeRichHtml`(`frontend/src/utils/sanitizeRichHtml.ts`)로
  에디터와 같은 Tiptap 스키마(`components/richTextExtensions.ts`)에 재파싱한 결과만 렌더한다. API 를 직접 호출해 넣은
  `<script>`·`onerror` 등 이벤트 핸들러·`iframe`·`javascript:` 링크는 제거되고 에디터 서식은 유지된다. 렌더 시점 정화라
  기존 저장분에도 적용된다. DB 에는 원문이 그대로 저장된다.

- 답글 입력도 등록 모달과 동일한 `RichTextEditor` 를 쓴다(2026-08-18부터). 사진 첨부(붙여넣기/업로드
  버튼), 동영상 업로드, 이모티콘, 서식(굵게/색상 등)을 등록 내용과 똑같이 쓸 수 있다.
  답글 목록도 저장된 HTML 을 정화한 뒤 렌더링한다(`dangerouslySetInnerHTML` + `sanitizeRichHtml`).
- 빈 내용(태그를 걷어낸 평문이 빈 문자열) 판정은 등록 모달의 `content_required` 검증과 동일한
  방식으로 한다.
- 답글 입력창은 `checking` 상태에서만 보인다. 완료되면 사라진다.
- Ctrl(⌘)+Enter 로 답글을 등록할 수 있다.
- 버튼: `VOC 삭제`(MASTER) / `답변완료로 처리`(본인 또는 MASTER, `checking` 일 때) / `닫기`
- **@멘션(2026-11-23)**: 답글에서도 `@` 로 팀·사용자를 태그한다(§4.4). 태그는 본문·답글에 강조 칩(`.mention`)으로 보인다.
  태그된 사용자도 답변완료 권한은 없다(작성자 본인·MASTER 만).

### 4.4 @멘션 추천 목록 (2026-11-23)
`frontend/src/components/VocMentionList.tsx`. VOC 등록 본문·답글 에디터에만 켠다(`RichTextEditor` 의 `mentionSuggestion` prop).
공지·가이드 등 다른 에디터는 멘션 노드를 렌더만 하고 `@` 추천은 뜨지 않는다(`richTextExtensions.SchemaMention`).

- `@` 만 치면: **팀** AGENT R·P·J·O·E 5개 + "이름·ID·부서를 입력하면 사용자도 찾을 수 있습니다" 안내.
- `@` 뒤에 글자를 치면: 팀은 이름으로 거르고, **사용자**는 `GET /api/users/?search=`(이름·loginid·부서, 200ms 지연)로 찾는다.
  미지정(`NONE`) 계정은 빼고 최대 8명. 로딩 중 / 검색 실패 / 결과 없음 문구를 각각 보여 준다.
- ↑/↓ 이동, Enter·Tab 선택, Esc 닫기, 마우스 클릭 선택.
- 고르면 본문에 `@AGENT R팀` / `@이름` 칩이 들어간다. 저장 HTML 은 `<span class="mention" data-type="mention" data-id="team:TE_R" data-label="AGENT R팀">`.
  렌더 정화(`sanitizeRichHtml`)는 이 span 의 `data-*`·`class` 를 유지하고 이벤트 핸들러·style 은 버린다.

---

## 5. 메일 알림

상세 규격은 `docs/MAIL.md` 를 함께 본다.

### 5.1 VOC 등록 (`voc_created`)
- 수신자: **`role='MASTER'` 사용자 중 VOC 메일을 켜둔 사람**(`UserProfile.receive_voc_mail`, 기본값 `True`)
  \+ **작성자 팀원 전원**(작성자가 AGENT R·P·J·O·E팀일 때, VOC 메일 켬) − 작성자 본인 (2026-11-20, `_resolve_voc_created_recipients`)
  \+ **본문에서 @멘션으로 태그한 팀원 전원**(VOC 메일 켬) + **태그한 사용자**(VOC 메일 설정 무관) (2026-11-23).
  MASTER·팀원이 늘어나도 설정 변경 없이 반영된다.
- MASTER 는 권한 관리 화면 MASTER 탭의 '이메일 설정' 컬럼에서 `VOC` 토글로 수신 여부를 켜고 끌 수 있다
  (`PATCH /api/users/{id}/voc-mail/`, 본인 또는 MASTER 만 변경 가능). 라인별 메일 설정(`mail_lines`/`receive_all_mail`)과는 별개 설정이다.
- AGENT 팀원도 서버에서는 같은 토글(`receive_voc_mail`)로 팀 발송(등록·답글)에서 빠질 수 있지만(API 허용 역할 MASTER·TE_R/P/J/O/E),
  ⚠️ **팀원용 토글 화면은 숨겨 두었다**(2026-11-20, 추후 재도입 가능). 팀원 값은 기본값(켜짐)이라 팀원 전원이 받는다.
- 제목: `[VOC 등록] {제목}`. 본문에서 팀을 태그했으면 앞에 `[R팀]` 처럼 붙는다(§5.4).

### 5.2 답글 등록 (`voc_comment`)
- 메일 본문(`_latest_comment_text`)은 최신 답글의 HTML 을 `_html_to_text` 로 평문화한 뒤 싣는다
  (VOC 등록 메일이 `voc.content` 를 평문화하는 것과 동일한 방식, 2026-08-18부터 —
  답글 입력이 RichTextEditor 로 바뀌어 `content` 가 HTML 이 됐기 때문이다).
- 수신자: **제출자 + 기존 답글 작성자 전원 + 작성자 팀원 전원(AGENT 팀, VOC 메일 켬) + 지금까지 @멘션 태그된 팀원 전원(VOC 메일 켬)
  \+ 지금까지 @멘션 태그된 사용자(설정 무관) − 이번 작성자 본인**
  (작성자 팀 = 등록 시점 `submitter_role`. **답글 작성자의 팀은 보지 않는다** — J팀 VOC 에 R팀이 답글을 달아도 R팀 전원에게는 가지 않는다.
  R팀 전원에게 보내려면 답글에서 `@AGENT R팀` 을 태그한다. 한 번 태그된 팀·사용자는 이후 답글 메일도 계속 받는다)
- **두 통으로 나눠 발송한다.** 제출자에게 가는 메일에만
  "답변이 만족스러우셨다면 답변 완료 처리 해주세요." 안내가 들어가기 때문이다
  (한 통에 여러 수신자를 담으면 본문을 개인화할 수 없다).
- 제목: `[VOC 답글] {제목}`. 이번 답글에서 팀을 태그했으면 앞에 `[R팀]` 처럼 붙는다(§5.4).

동작 예시 — A 가 등록, B 가 답글, 이어서 C 가 답글:

| 시점 | 제출자용 메일 | 그 외 참여자용 메일 |
|------|-------------|-------------------|
| A 등록 | — | MASTER 전원 (`voc_created`) |
| B 답글 | A (완료 안내 **포함**) | 없음 |
| C 답글 | A (완료 안내 **포함**) | B (안내 없음) |

A 가 AGENT 팀원이면 각 행의 '그 외 참여자용'(등록 행은 `voc_created`)에 A 의 팀원 전원(A 제외, 토글 켬)이 더해진다.
상세 규칙은 `docs/MAIL.md` §2.1.

### 5.3 본문 디자인
결재 알림과 같은 **히어로 헤더 + 카드형** 템플릿을 쓴다(`mailer._render_voc_email`).
결재용 `_render_hero_kpi_email` 은 의뢰서와 결재 경로 카드를 필수로 요구해 재사용할 수
없어 VOC 전용으로 따로 두되, `EVENT_THEME` 색상 테마는 공유한다.

- `voc_created`: 블루(`stage_arrival` 테마)
- `voc_comment`: 퍼플(`notify_submitted` 테마)

카드 구성: VOC 제목 → 2×2 정보 타일(작성자 팀 / 접수일 / 작성자 / 상태 — 2026-11-20 유형·관련 페이지에서 교체) → 내용 →
(제출자에게만) 완료 처리 안내 → `VOC 상세에서 확인하기` 버튼

> VOC 는 라인 개념이 없어 라인별 메일 수신 설정(`UserProfile.mail_lines`) 필터를 타지 않는다.

### 5.4 제목 접두어 — 팀 태그 (2026-11-23)
- 그 등록·답글에서 **팀을 태그했을 때만** 제목 맨 앞에 짧은 팀 이름을 붙인다: `[R팀] [VOC 답글] {제목}`.
- 여러 팀이면 R·P·J·O·E 순으로 이어 붙인다: `[R팀][J팀] [VOC 등록] {제목}` (`mailer.VOC_MENTION_SUBJECT_LABEL`).
- 태그 없이 달린 이후 답글 메일은 평소 제목이다(태그된 팀은 계속 받지만 접두어는 없다).
- 제출자용·그 외용 두 통 모두 같은 제목이다. 사용자만 태그했으면 접두어가 없다.

---

## 6. i18n

키 네임스페이스는 `voc.*` 이며 `ko.json` / `en.json` 에 **34개씩 동일하게** 존재한다.
2026-11-23 @멘션으로 `content_placeholder`·`mention_group_team`·`mention_group_user`·`mention_hint`·`mention_no_user`·`mention_search_error`
6개를 추가하고, `comment_placeholder` 문구에 `@` 태그 안내를 덧붙였다.
2026-11-20 유형·페이지 폐지로 `category`·`category_*`(4)·`page`·`page_*`(4) 10개를 삭제하고 `team`·`team_etc` 를 추가했다.
반려 관련 키(`status_rejected`, `reject_btn`, `reject_reason_placeholder`,
`reject_confirm`)는 반려 제거와 함께 삭제했다.

---

## 7. 알려진 사항

| 항목 | 내용 |
|------|------|
| `VOC.response` | 값을 채우는 코드가 없다(답변은 답글로 남긴다) |
| `VocHistory` | 완전 미사용 모델. 레코드 생성 코드 없음 |
| `vocAPI.updateResponse` | `client.ts` 에 정의만 있고 호출처가 없다 |
| 필터 상호배타 | '내 VOC' · '팀' · '상태(확인중/답변완료)' 를 동시에 적용할 수 없다(단일 탭 선택 UI) |
| `StatusBadge` | `rejected` 매핑은 결재가 쓰므로 남아 있다. VOC 는 더 이상 이 값을 만들지 않는다 |
| 댓글 렌더링을 HTML(`dangerouslySetInnerHTML`)로 바꾼 배경 | 2026-08-18 이전에는 `VocComment.content` 가 평문이었고 텍스트로만 렌더링됐다. 배포 시점에 기존 댓글 데이터가 없어(신규 기능) 과거 평문 댓글이 HTML 로 오인 렌더링될 데이터가 없었고, 그래서 별도 이스케이프 마이그레이션 없이 전환했다 |
