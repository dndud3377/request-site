# Validation System 리뷰 지적 수정 — Overview

> **오케스트레이터는 이 파일만 읽는다.** 태스크 본문은 `task-N.md`에 있고, 서브에이전트에 **경로로 넘긴다**(내용을 복사해 오지 않는다).

**Goal:** 2026-08-03 구현분에 대한 코드 리뷰가 찾아낸 BLOCKER 1건 + HIGH 4건을 고치고, 각 수정을 회귀 테스트로 고정한다.

**Architecture:** 새 기능을 만들지 않는다. 이미 구현된 "Validation System 판정 주체 상신자 단일화" 코드의 결함만 제거한다. 수정은 백엔드 `views.py` 4곳과 프론트 `ValidationSystem.tsx` 1곳에 국한되며 각각 독립적으로 되돌릴 수 있다. 작업 전 현재 상태를 커밋해 리뷰가 본 트리로 돌아갈 기준점을 만든다.

**Tech Stack:** Django 4.2.13 + DRF 3.15.1 / React 18.2 + TypeScript 4.9.5 strict / MySQL 8.0 / Docker Compose (dev)

---

## Global Constraints

모든 태스크의 요구사항에 암묵적으로 포함된다.

- **작업 위치:** `/Users/mac_wb/codespace/request-site/.claude/worktrees/bridge-cse_01Ueeczx2qjGTBUApYUboKsd` — 브랜치 `woobin`. **메인 워크트리(`~/codespace/request-site`)가 아니다.** 이 문서의 모든 상대 경로는 이 디렉터리 기준이다.
- **브랜치 base:** `origin/main` = `0cd18a6`. 드리프트 0 — **리베이스하지 말 것.**
- **push 금지.** `woobin`은 아직 원격에 없다. 사용자가 명시적으로 요청하기 전까지 `git push` 하지 않는다.
- **프로젝트 규칙(`CLAUDE.md`)이 전부 적용된다.** 특히 규칙 E(파일별 개별 커밋) · 규칙 H(요청 범위 최소) · 규칙 I(`any` 금지, 매직 스트링 상수화) · 규칙 G(ko/en 동시 추가 — 이번 작업에선 **신규 i18n 키가 없어야 정상**이다).
- **테스트 실행 환경이 없을 수 있다.** `frontend/node_modules` 미설치, `.env.dev` 없음, `request_backend_dev` 컨테이너 미기동. 각 태스크의 테스트 실행 단계에서 환경이 없으면 **실행하지 못했다고 명시적으로 기록**하고 다음으로 넘어간다. **통과했다고 쓰지 않는다.** 환경 기동 절차는 아래 "부록 A".
- **`.env` 계열 파일을 만들지 않는다**(규칙 D). 사용자가 직접 만들어야 한다.
- **범위 밖 — 손대지 말 것:** 리뷰의 MEDIUM 7건 · LOW 3건(목록은 `task-6.md` 부록 B) · `frontend/package.json` proxy(`8000`→`8001`) · 폼 기본값(`frontend/src/pages/RequestPage/constants.ts:236` = `VS_NONTARGET`)과 상세보기 폴백(`VS_TARGET`)의 기존 불일치.

---

## 배경 — 이 코드가 무엇을 하는가

의뢰서에는 "Validation System 대상/비대상" 판정값이 있다. J-layer 표의 `pp` 열에 `plel` 키워드가 있는 문서만 판정 대상이고(없으면 '해당없음'), 그런 문서는 결재 경로에 E(MASK) 단계가 붙는다.

2026-08-03 변경의 핵심은 **판정 주체를 상신자 하나로 단일화**한 것이다. 이전에는 MASK(E) 팀이 합의하면서 값을 바꿀 수 있었는데, 이제 MASK는 확인 후 '합의'만 하고 이견이 있으면 '수정 요청'을 보낸다. 상신자가 진행 중 문서의 값을 바꾸는 전용 API(`POST /api/documents/<id>/validation-system/`)가 신설됐고, E 담당자가 이미 합의한 뒤에 값이 바뀌면 **E 단계만 재검토(pending)로 되감는다**(반려처럼 새 회차를 돌리지 않는다).

되감기와 수정 요청의 사유는 **`ApprovalStep.comment`에 누적**된다. `ApprovalStep` 모델에는 이력 전용 필드가 없어서(`backend/api/models.py:228`의 `comment` TextField가 전부) 이곳이 유일한 저장소다. 화면에서는 결재 경로 탭에 `whiteSpace: 'pre-wrap'`으로 렌더된다(`frontend/src/components/PagedDetailView.tsx:1771`).

---

## 태스크 목록

| # | 제목 | 대상 파일 | 완료 판정 |
|---|---|---|---|
| 0 | 리뷰 대상 스냅샷 커밋 | (커밋만, 16개 파일) | `git status --short`가 비고 `git log --oneline -6`에 커밋 5개 |
| 1 | [BLOCKER] 토글 배열 타입 단언 복원 | `frontend/src/components/ValidationSystem.tsx:47` | `cd frontend && npx tsc --noEmit` → `ValidationSystem.tsx` 오류 0건 |
| 2 | [HIGH] 저장 실패 시 되감기 차단 | `backend/api/views.py:1386-1404, 1096-1099` · `backend/api/tests.py` | `docker exec -it request_backend_dev python manage.py test api.tests.PEStageReviewerFlowTest -v 2` |
| 3 | [HIGH] 레거시 문서 폴백 정규화 | `backend/api/views.py:1374-1375, 1092-1094` · `backend/api/tests.py` | 동일 명령 |
| 4 | [HIGH] `_create_reviewers` 중복 가드 제거 | `backend/api/views.py:841-847` · `backend/api/tests.py` | 동일 명령 |
| 5 | [HIGH] E/EV 합의가 이력을 덮어쓰지 않게 | `backend/api/views.py:502-506` · `backend/api/tests.py` | 동일 명령 |
| 6 | 전체 검증과 보고 | `docs/E2E_TEST_AND_BUGS.md` (조건부) | `docker exec -it request_backend_dev python manage.py test api -v 2` + `cd frontend && npx tsc --noEmit` |

## 순서 의존성

- **Task 0을 반드시 먼저 실행한다.** 워크트리에 커밋이 0개라, 스냅샷 없이 수정을 시작하면 리뷰가 본 상태로 돌아갈 방법이 사라진다.
- **Task 2 → Task 3 순서를 지킨다.** 둘 다 `backend/api/views.py`의 같은 함수(`update_validation_system`, 1092~1099행 구간)를 수정한다. Task 2가 `_set_validation_system`의 반환값을 도입하고, Task 3이 그 바로 위의 비교 로직을 바꾼다.
- **Task 4, Task 5는 서로, 그리고 Task 2·3과 독립적이다.** `views.py`의 다른 구간(841-847 / 502-506)을 건드린다. 단 **모두 같은 파일**이므로 병렬 실행하면 충돌한다 — 순차로 돌린다.
- **Task 1은 프론트 단독**이라 백엔드 태스크와 파일이 겹치지 않는다.
- **Task 2~5는 모두 `backend/api/tests.py`의 같은 클래스(`PEStageReviewerFlowTest`)에 테스트를 추가한다.** 각 태스크의 본문에 "어느 메서드 바로 뒤에 추가하는지"가 적혀 있고, 그 순서는 Task 2 → 3 → 4 → 5 누적이다. 순서를 어기면 삽입 위치를 찾지 못한다.
- **Task 6은 마지막.** Task 1~5의 결과를 모두 요구한다.

**실행 형태 권장:** 순차(sequential). 태스크 7개 중 5개가 `backend/api/views.py`와 `backend/api/tests.py`를 공유하므로 서브에이전트 팬아웃이 이득이 없고 충돌만 만든다.

---

## 검토했다가 기각한 대안

새 세션이 같은 대안을 다시 제안하지 않도록 사유와 함께 남긴다.

| 대안 | 기각 사유 |
|---|---|
| **Task 1을 `constants.ts`에서 고친다** — `VS_TARGET`에 `as const`나 타입 주석을 붙인다 | `VS_TARGET`은 이 파일 밖 여러 곳에서 쓰인다. 상수 선언의 타입을 좁히면 파급 범위가 커지고 규칙 H에 어긋난다. 문제가 생긴 배열 하나만 좁힌다 |
| **Task 2에서 400을 반환한다** | 실패 원인이 서버에 저장된 `additional_notes`의 손상이다. 클라이언트가 요청을 고쳐 해결할 수 있는 문제가 아니므로 4xx가 아니다 |
| **Task 2에서 예외를 raise 한다** | `@transaction.atomic` 안이라 롤백은 깨끗하지만, 이미 아무것도 쓰지 않은 상태라 롤백할 게 없다. `Response` 반환이 더 단순하고 응답 본문을 통제할 수 있다 |
| **Task 3을 프론트에서 고친다** — `PagedDetailView.tsx`의 `VS_TARGET` 폴백을 없앤다 | 이 폴백은 이번 변경이 만든 게 아니라 `HEAD`(`0cd18a6`)에 이미 있던 기존 동작이다(`git show HEAD:frontend/src/components/PagedDetailView.tsx`로 확인 가능, 626-630행). 기존 표시 규칙을 바꾸면 무관한 문서들의 표시가 달라진다. **어긋난 쪽은 새로 생긴 백엔드 비교 로직이다** |
| **Task 3에서 폼 기본값(`VS_NONTARGET`)에 맞춘다** | 화면이 표시하는 값은 `VS_TARGET`이다. 사용자가 보고 있는 것과 다른 기준으로 비교하면 같은 버그가 방향만 바뀌어 재발한다 |
| **Task 4에서 가드를 고쳐 쓴다** — `to_create`만 필터링하도록 조건을 좁힌다 | `_validate_reviewers`(`backend/api/views.py:810-819`)가 **이미** 그 회차의 기존 검토자를 `existing_loginids`로 제외하고 `to_create`만 돌려준다. 중복 생성은 애초에 일어나지 않았으므로 가드 자체가 불필요하다. 통째로 되돌리는 게 맞다 |
| **Task 5를 모든 agent에 적용한다** — `approve_step`이 항상 comment를 누적하게 한다 | 이력이 쌓이는 곳은 E/EV step뿐이다. `comment`를 덮어쓰는 다른 지점(`views.py:711` non-E/EV 반려, `1263` `_advance_after_pl`, `1307` `peer_reject`)은 E/EV를 밟지 않는다. 다른 단계의 동작을 바꾸면 회귀 위험만 늘어난다 |
| **Task 5 대신 이력 전용 저장소를 만든다** — `detail`에 history 배열을 추가하거나 모델에 필드를 추가한다 | 설계 결정 Q7이 "값이 `YES`/`NO` 둘뿐이라 전체 이력 배열은 과하다"며 이미 기각했다. trail을 지울 수 있는 경로가 `views.py:504` 하나뿐임을 확인했으므로(`711`은 non-E/EV, `1263`/`1307`은 PL 전용, 재상신은 `round+1`로 이전 회차 step을 보존), 그 하나를 막으면 Q7의 근거가 실제로 성립한다. 마이그레이션도 불필요하다 |
| **MEDIUM 7건을 함께 고친다** | 사용자가 범위를 BLOCKER+HIGH로 명시적으로 한정했다. 목록은 `task-6.md` 부록 B에 기록만 한다 |

---

## 부록 A: 검증 환경 띄우기

**`.env.dev`는 에이전트가 만들 수 없다**(규칙 D). 사용자에게 아래를 요청한다.

```bash
cd /Users/mac_wb/codespace/request-site/.claude/worktrees/bridge-cse_01Ueeczx2qjGTBUApYUboKsd
cp .env.dev.example .env.dev
```

`.env.dev`에서 두 줄을 이 맥에 맞게 고쳐야 한다(`.env.dev.example:55,64`가 사내 레지스트리 플레이스홀더다):
- `IMAGE_PATH=` (빈 값)
- `NPM_REGISTRY_URL=https://registry.npmjs.org`

그 다음:
```bash
docker compose -f docker-compose.dev.yml up -d db backend
docker exec -it request_backend_dev python manage.py test api
```

주의사항:
- 파일명은 `.env`가 아니라 **`.env.dev`**다(`docker-compose.dev.yml:61`의 `env_file`).
- `docker ps`에 보이는 `reqsite_sdd_test` / `reqsite_sdd_test2`는 **무관한 샌드박스**다. 실제 컨테이너는 `request_backend_dev` / `request_frontend_dev` / `request_nginx_dev` / `request_db_dev`.
- frontend 컨테이너에는 **볼륨 마운트가 없다**(`docker-compose.dev.yml:101-112`) — CSS 한 줄 고칠 때마다 npm 빌드 전체가 다시 돈다. UI를 반복해서 보려면 `cd frontend && npm install && npm start`(HMR, `localhost:3000`)가 낫다. 단 `frontend/package.json:46`의 `"proxy": "http://localhost:8000"`이 컨테이너 매핑(호스트 **8001**)과 어긋난다. **이 값은 범위 밖이므로 커밋하지 말 것** — 로컬에서 임시로 바꿨다면 커밋 전에 되돌린다.
- **`react-scripts test`는 Babel을 쓰므로 타입 체크를 하지 않는다.** `npm test`가 통과해도 Task 1의 BLOCKER가 잡혔다는 증거가 되지 못한다. `npx tsc --noEmit`이 유일한 근거다.
- 메일 실제 발송은 사내 DXHUB 게이트웨이 경유라 이 맥에서 확인할 수 없다. 대신 `MailNotification` 행의 `contents`를 꺼내 HTML로 열면 본문을 눈으로 볼 수 있다. dev 백엔드는 `SKIP_SCHEDULER=true`라 재시도가 돌지 않아 행이 그대로 남는다.
