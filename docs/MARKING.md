# MARKING — 결재 현황 개인 마킹(범주)

> 작성일: 2026-09-07
> 목적: 결재 현황에서 개인이 의뢰서를 "범주"(도형 1종 + 테마 색상)로 마킹하는 기능의 데이터 모델·API·화면 동작을 기록한다.
> 이 기능은 **완전히 개인 전용**이다 — 다른 사용자와 절대 공유되지 않는다.

- 프론트 라우트: `/approval`
- 진입 컴포넌트: `frontend/src/pages/ApprovalPage.tsx`
- 마킹 UI 컴포넌트: `frontend/src/components/DocumentMark.tsx` (`MarkDot`, `MarkCategorySettingsModal`)
- 백엔드: `backend/api/models.py` (`PersonalMarkCategory`, `PersonalDocumentMark`), `backend/api/views.py`
  (`PersonalMarkCategoryViewSet`, `RequestDocumentViewSet.mark` 액션), `backend/api/serializers.py`
  (`PersonalMarkCategorySerializer`, `RequestDocumentListSerializer.my_mark_category`)

---

## 1. 개념

- **도형은 하나(●), 색으로만 구분한다.** 결재 현황 표에 전용 컬럼을 두지 않고, "제품 조합" 셀
  맨 앞에 점 하나를 인라인으로 붙인다.
- **범주는 개인이 자유롭게 추가·삭제·이름 변경한다.** 고정된 5개 슬롯이 아니라, 사용자가 만들고
  지우는 목록이다.
- **색은 임의의 색이 아니라 앱 테마 색상 중에서만 고른다.** `danger`(빨강) / `warning`(주황) /
  `success`(초록) / `accent`(파랑) / `pause`(브라운) — `frontend/src/styles/global.css`의
  Bright Blue Theme 의미색 토큰과 같은 키다.
- **범주와 마킹은 다른 사용자와 공유되지 않는다.** 자세한 근거는 §4 참조.

## 2. 데이터 모델

### 2.1 PersonalMarkCategory (범주)
`backend/api/models.py`

| 필드 | 의미 |
|------|------|
| `user` | 소유자. CASCADE — 사용자가 삭제되면 범주도 함께 삭제 |
| `name` | 범주 이름(최대 30자, 사용자가 직접 입력) |
| `color` | `danger`/`warning`/`success`/`accent`/`pause` 중 하나 |
| `order` | 표시 순서(현재 프론트에서는 쓰지 않음 — 확장 대비 필드) |

### 2.2 PersonalDocumentMark (문서별 개인 마킹)
`backend/api/models.py`

| 필드 | 의미 |
|------|------|
| `user` | 소유자 |
| `document` | 마킹 대상 의뢰서(`RequestDocument`) |
| `category` | 범주. `on_delete=SET_NULL` — 범주가 삭제되면 이 마킹은 자동으로 "표시 없음"(`None`)이 된다 |

> "표시 없음"으로 되돌리는 것(§3의 `POST .../mark/` with `category: null`)은 이 행의 `category`를
> `None`으로 갱신하는 게 아니라 **행 자체를 삭제**한다 — 이 문서·사용자 조합의 마킹 이력을
> 아예 남기지 않는다.

`unique_together = ('user', 'document')` — 한 사용자가 한 문서에 가질 수 있는 마킹은 하나뿐이다
(도형이 하나이므로 다중 선택이 아니다).

## 3. API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/mark-categories/` | 내 범주 목록(다른 사용자 것은 절대 포함되지 않음) |
| POST | `/api/mark-categories/` | 범주 추가. body: `{ name, color }` |
| PATCH | `/api/mark-categories/{id}/` | 이름·색 변경. body: `{ name? , color? }` |
| DELETE | `/api/mark-categories/{id}/` | 범주 삭제. 이 범주로 마크돼 있던 문서는 서버가 자동으로 표시 없음 처리(SET_NULL) |
| POST | `/api/documents/{id}/mark/` | 이 문서에 대한 내 마킹 설정/해제. body: `{ category: <id> \| null }` |

`RequestDocumentListSerializer`(결재 현황 목록 응답)에는 `my_mark_category`(범주 id 또는 `null`)가
포함된다. **다른 사용자의 마킹은 이 필드에 절대 나타나지 않는다** — `RequestDocumentViewSet.get_queryset`이
`Prefetch('personal_marks', queryset=PersonalDocumentMark.objects.filter(user=request.user), to_attr='my_marks')`로
호출자 것만 미리 걸러 두기 때문이다(N+1도 이 prefetch로 방지한다).

## 4. 다른 사용자와 공유되지 않는 이유

1. `PersonalMarkCategory`·`PersonalDocumentMark` 모두 `user` 외래키가 필수라, 같은 이름의 범주를
   여러 사람이 만들어도 서로 다른 레코드다.
2. `PersonalDocumentMark`는 `unique_together('user','document')` — 같은 문서라도 사람마다 별개
   마킹을 가진다.
3. 임시저장 공유(`RequestDocument.shared_group`, "누가 문서를 볼 수 있는가")와는 완전히 별개
   데이터라, 문서를 그룹과 공유해도 마킹은 따라가지 않는다.
4. API 쪽에서도 `PersonalMarkCategoryViewSet.get_queryset`과 `RequestDocumentViewSet`의 prefetch가
   항상 `request.user` 기준으로만 걸러 응답한다.
5. **예외**: Django 관리자(서버 DB 접근 권한이 있는 관리자)는 시스템 전체에 대해 원래 모든 테이블을
   볼 수 있다 — 이는 이 기능만의 특례가 아니라 시스템 전반에 적용되는 별개 사항이다.
6. `POST /documents/{id}/mark/`와 `POST /mark-categories/` 는 비인증(`AnonymousUser`) 요청이면
   `NotAuthenticated`(401)로 명시적으로 막는다 — 개발 모드의 `IsAuthenticatedInProd`는 인증 여부와
   무관하게 통과시키므로, 이 가드가 없으면 로그인 없는 요청이 그대로 저장 로직까지 도달해
   `PersonalDocumentMark.user`/`PersonalMarkCategory.user`(FK)에 `AnonymousUser`를 대입하려다
   서버 에러가 났다.

## 5. 결재 현황 화면 동작

- **필터 방식**: 기존 라인/목적/MAP 목적/상신일 필터와 동일하게 **클라이언트 사이드**로 동작한다
  (`ApprovalPage.tsx`의 `filteredDocs` useMemo). 서버는 `mark_category` 같은 쿼리 파라미터를
  받지 않는다 — 목록에 이미 실려 온 `my_mark_category` 값으로 프론트에서 걸러낸다.
- **마킹 점 클릭**: `MarkDot`이 `position:fixed` 팝오버로 내 범주 목록 + "표시 없음"을 보여준다
  (표(`.table-wrapper`)가 `overflow:hidden`이라 `position:absolute`로 띄우면 잘리기 때문).
  선택하면 `POST /documents/{id}/mark/`로 즉시 저장하고, 실패하면 낙관적 업데이트를 되돌리고
  토스트로 알린다.
- **범주 설정**: 컬럼 필터 바의 "⚙ 범주 설정" 버튼 → `MarkCategorySettingsModal`. 이름은
  `onBlur` 시점에 저장하고(매 키 입력마다 API를 부르지 않는다), 색은 클릭 즉시 저장한다.
  삭제는 확인 대화상자 없이 즉시 처리된다. **이름·색·삭제 모두 저장이 실패하면 화면을 이전
  상태로 되돌리고** 토스트로 알린다(마킹 점과 동일한 낙관적 업데이트 + 롤백 패턴).
- **새 범주의 기본 색**: 테마 색상 5개를 `[danger, warning, success, accent, pause]` 순서로
  범주 개수만큼 순환 배정한다 — 6번째 범주부터는 색이 겹치기 시작한다(알려진 제한, §6).

## 6. 알려진 제한사항 / 확인이 필요한 것

- **색상 팔레트 소진**: 테마 색상은 5가지뿐이다. 범주를 6개 이상 만들면 자동 배정 색이 겹친다.
  (사용자가 직접 다른 색으로 바꿔 회피할 수는 있다.)
- **범주 삭제 시 확인 없음**: 삭제 버튼을 누르면 즉시 삭제되고, 그 범주로 마크돼 있던 문서는
  조용히 "표시 없음"이 된다. 되돌릴 수 없다.
- **가이드 투어(전체 가이드)의 가짜 문서**: `TOUR_APPROVAL_DOCS` 같은 데모용 문서에도 마킹 점이
  렌더링된다. 실제로 클릭해 저장을 시도하면(존재하지 않는 문서 id) 실패 토스트가 뜬다 — 투어
  진행 자체를 막지는 않는다.

## 7. i18n 키

`frontend/src/locales/{ko,en}.json`의 `approval.*` 네임스페이스:

`col_category`, `category_settings_btn`, `category_settings_title`, `category_settings_help`,
`category_add`, `category_new_default_name`, `category_none`, `category_manage_link`,
`category_pick_color`, `category_delete_title`
