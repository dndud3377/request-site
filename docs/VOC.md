# VOC — 고객의 소리 페이지 (VOCPage)

> 작성일: 2026-08-12
> 목적: VOC 기능의 **실제 구현 동작**을 기록한다. 의도와 구현이 일치하는지 검증할 때
> 이 문서를 기준으로 확인한다. (⚠️ 표시는 "확인이 필요"하거나 "미사용"인 부분이다.)

- 프론트 라우트: `/voc`
- 진입 컴포넌트: `frontend/src/pages/VOCPage.tsx`
- 백엔드: `backend/api/views.py` (`VOCViewSet`), `backend/api/models.py`
- 본인 판정 헬퍼: `backend/api/doc_permissions.py` (`is_voc_submitter`)
- 메일: `backend/api/mailer.py` (`enqueue_voc_created` / `enqueue_voc_comment`)

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
| `category` | `inquiry`(문의) / `error_report`(오류 신고) / `feature_request`(기능 제안) / `task_request`(작업 요청) |
| `submitter` | **제출자 FK(User).** 등록 시 서버가 `request.user` 로 확정한다 |
| `submitter_name` / `submitter_email` | 제출자 표시용 비정규화 값(프론트가 보낸 값) |
| `page` | 관련 페이지 `request` / `approval` / `history` / `other` |
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
| `content` | 내용(평문) |
| `created_at` | 작성일시. 정렬 기준(오름차순) |

### 1.3 VocHistory
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
| DELETE | `/api/voc/{id}/` | 삭제. **MASTER 전용** (`IsAuthenticatedOrMasterDelete`) |
| PATCH | `/api/voc/{id}/update-status/` | 상태 변경. `completed` 로만 가능 |
| POST | `/api/voc/{id}/comment/` | 답글 등록. 응답은 VOC 전체(댓글 포함) |

### 2.1 목록 쿼리 파라미터

| 파라미터 | 의미 |
|---------|------|
| `mine=true` | 로그인 사용자가 등록한 VOC 만. **사용자 id 를 보내지 않는다**(§3.1) |
| `category` | 유형 필터 |
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
| 삭제 | **MASTER 전용** |

> 답변 완료를 시도한 사람이 작성자도 MASTER 도 아니면 403
> (`작성자 본인 또는 관리자만 완료 처리할 수 있습니다.`).
> `completed` 이외의 상태로 바꾸려 하면 400 (`유효하지 않은 상태입니다.`).

---

## 4. 화면 흐름

### 4.1 목록
헤더(+ VOC 등록 버튼) → 필터 탭(전체 / 내 VOC / 유형 4개) + 검색창 → 테이블
(No. / 제목 / 유형 / 페이지 / 제출자 / 상태 / 접수일)

- 제목을 클릭하면 상세 모달이 열린다.
- `?id=123` 쿼리로 진입하면 해당 VOC 상세가 자동으로 열린다(메일 딥링크용).

### 4.2 등록 모달
제목(필수) / 유형 / 페이지(필수) / 내용(필수, RichTextEditor)

- 내용은 태그를 걷어낸 평문이 비어 있으면 등록을 막는다.
- 입력칸 높이는 `RichTextEditor` 의 `EDITOR_MIN_HEIGHT`(240px)를 따른다.

### 4.3 상세 모달
메타 정보(유형 / 페이지 / 상태 / 접수일·제출자) → 원본 내용(HTML 렌더) → 답글 목록 → 답글 입력

- 답글 입력창은 `checking` 상태에서만 보인다. 완료되면 사라진다.
- Ctrl(⌘)+Enter 로 답글을 등록할 수 있다.
- 버튼: `VOC 삭제`(MASTER) / `답변완료로 처리`(본인 또는 MASTER, `checking` 일 때) / `닫기`

---

## 5. 메일 알림

상세 규격은 `docs/MAIL.md` 를 함께 본다.

### 5.1 VOC 등록 (`voc_created`)
- 수신자: **`role='MASTER'` 사용자 중 VOC 메일을 켜둔 사람**(`UserProfile.receive_voc_mail`, 기본값 `True`)의 `mail`.
  MASTER 계정이 늘어나도 설정 변경 없이 반영된다.
- 개별 MASTER 는 권한 관리 화면 MASTER 탭의 '이메일 설정' 컬럼에서 `VOC` 토글로 수신 여부를
  켜고 끌 수 있다(`PATCH /api/users/{id}/voc-mail/`, 본인 또는 다른 MASTER 만 변경 가능).
  라인별 메일 설정(`mail_lines`/`receive_all_mail`)과는 별개 설정이다.
- 제목: `[VOC 등록] {제목}`

### 5.2 답글 등록 (`voc_comment`)
- 수신자: **제출자 + 기존 답글 작성자 전원 − 이번 작성자 본인**
- **두 통으로 나눠 발송한다.** 제출자에게 가는 메일에만
  "답변이 만족스러우셨다면 답변 완료 처리 해주세요." 안내가 들어가기 때문이다
  (한 통에 여러 수신자를 담으면 본문을 개인화할 수 없다).
- 제목: `[VOC 답글] {제목}`

동작 예시 — A 가 등록, B 가 답글, 이어서 C 가 답글:

| 시점 | 제출자용 메일 | 그 외 참여자용 메일 |
|------|-------------|-------------------|
| A 등록 | — | MASTER 전원 (`voc_created`) |
| B 답글 | A (완료 안내 **포함**) | 없음 |
| C 답글 | A (완료 안내 **포함**) | B (안내 없음) |

### 5.3 본문 디자인
결재 알림과 같은 **히어로 헤더 + 카드형** 템플릿을 쓴다(`mailer._render_voc_email`).
결재용 `_render_hero_kpi_email` 은 의뢰서와 결재 경로 카드를 필수로 요구해 재사용할 수
없어 VOC 전용으로 따로 두되, `EVENT_THEME` 색상 테마는 공유한다.

- `voc_created`: 블루(`stage_arrival` 테마)
- `voc_comment`: 퍼플(`notify_submitted` 테마)

카드 구성: VOC 제목 → 2×2 정보 타일(유형 / 관련 페이지 / 작성자 / 상태) → 내용 →
(제출자에게만) 완료 처리 안내 → `VOC 상세에서 확인하기` 버튼

> VOC 는 라인 개념이 없어 라인별 메일 수신 설정(`UserProfile.mail_lines`) 필터를 타지 않는다.

---

## 6. i18n

키 네임스페이스는 `voc.*` 이며 `ko.json` / `en.json` 에 **36개씩 동일하게** 존재한다.
반려 관련 키(`status_rejected`, `reject_btn`, `reject_reason_placeholder`,
`reject_confirm`)는 반려 제거와 함께 삭제했다.

---

## 7. 알려진 사항

| 항목 | 내용 |
|------|------|
| `VOC.response` | 값을 채우는 코드가 없다(답변은 답글로 남긴다) |
| `VocHistory` | 완전 미사용 모델. 레코드 생성 코드 없음 |
| `vocAPI.updateResponse` | `client.ts` 에 정의만 있고 호출처가 없다 |
| 필터 상호배타 | '내 VOC' 와 '유형' 을 동시에 적용할 수 없다(단일 탭 선택 UI) |
| `StatusBadge` | `rejected` 매핑은 결재가 쓰므로 남아 있다. VOC 는 더 이상 이 값을 만들지 않는다 |
