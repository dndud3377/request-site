# FIX_PROGRESS — 의뢰서/결재/이력 오류 수정 진행 기록

> 작업 브랜치: `claude/adoring-cori-an1o34`
> 최초 작성일: 2026-06-11
> 목적: 의뢰서 작성 / 결재 현황 / 이력 조회 페이지의 오류를 점검·수정하는 작업의
> 진행 상황과 검증 방법을 한 곳에 기록한다. (컨텍스트 압축 대비 — CLAUDE.md 규칙 F)

---

## 0. 작업 배경 (사용자 요청 6개 조건)

1. 의뢰서 작성 페이지 기능 파악 → 의도대로인지 확인
2. 의뢰서 작성 시 안정성·오류 위험 점검
3. 작성 data가 결재 현황/이력 조회에 잘 보이고 backend에도 잘 저장되는지 확인
4. 결재 현황 case별 진행 흐름 확인
5. DB가 제대로 축적되는지 확인
6. **상신이 실패하는 경우가 있으면 안 된다** — 상신 실패 경로 제거

### 확정된 결정 사항
- 우선순위: **전부 순차 진행** (상신 → 검증 → error 순)
- "상신 시 J-layer 활성 행 전체 Bb 매핑 필수" 규칙 → **의도된 규칙, 유지**(수정 대상 아님)
- 진행 방식: **항목별 계획 승인 후 진행**, 파일별 개별 커밋 (규칙 E)

### 핵심 사실(분석으로 확정)
- J/O-layer/Bb 등 모든 상세는 별도 테이블이 아니라
  `RequestDocument.additional_notes`(TextField)에 **JSON 문자열**로 저장됨
  (JSONField 아님 → 깨진 JSON도 DB는 받고 `get_detail()`이 조용히 `{}` 반환).
- 결재 흐름: `draft → under_review → approved | rejected`,
  결재선 = `PL검토 → R → (P→J) ∥ (O [+E]) → 모두 합의 시 approved`.
- 백엔드에 `ATOMIC_REQUESTS` 미설정 → ORM 쓰기가 건별 autocommit.
- 결재 흐름 문서(`docs/APPROVAL.md`)는 **현재 없음** → 모든 항목 완료 후 신규 작성 예정.

---

## 1. 진행 상태 요약

| 항목 | 내용 | 상태 |
|------|------|------|
| 항목 1 | 상신 실패 방지 (race + 트랜잭션) | ✅ 완료 (코드/푸시), ⏳ docker 검증 대기 |
| 항목 2 | step 검증 정합성 (렌더 step↔validate 불일치, J-layer 미검증, 중복 블록) | ⬜ 계획 단계 |
| 항목 3 | 결재/이력 조회 error 상태 처리 (규칙 J) | ⬜ 대기 |
| (후보) | J/O/E 동시 합의 lost-update 방지 (`select_for_update`) | ⬜ 미정 |
| (후보) | `additional_notes` JSON 손상 방어 / silent 유실 방지 | ⬜ 미정 |
| (마무리) | `docs/APPROVAL.md` 신규 작성, 관련 docs 최신화 | ⬜ 대기 |

---

## 2. [항목 1] 상신 실패 방지 — 완료 내역

### 무엇을 고쳤나

**커밋 1 — `1641b14`** `frontend/src/pages/RequestPage/index.tsx`
- `isPersistingRef = useRef(false)` 가드 추가.
- `handleSaveDraft` / `handleIdleAutoSave` / `handleSubmit` 진입 시 ref가 이미
  `true`면 즉시 return, 시작 시 `true`, `finally`에서 `false`.
- (주의) `handleSubmit`은 "지정자 필수" 조기 return **이후**에 ref를 점유하도록 배치 →
  조기 return 시 ref 누수 없음.
- 해결: 신규 작성(savedId 없음) 중 20분 유휴 자동저장과 상신이 겹쳐 양쪽이 각각
  `documentsAPI.create()`를 호출 → **의뢰서 2건 중복 생성**되던 race 차단.

**커밋 2 — `af22f13`** `backend/api/views.py`
- `from django.db import connection, transaction` (transaction 추가).
- 상태전이 액션의 다중 DB 쓰기를 트랜잭션으로 묶음:
  - 쓰기 구간만 `with transaction.atomic():` — `submit`, `resubmit`, `withdraw`,
    `reject_step`, `peer_approve`, `peer_reject`, `peer_submit`
  - 분기가 많은 `approve_step`은 메서드 레벨 `@transaction.atomic` 데코레이터로 전체 래핑
    (검증 실패 early-return은 commit할 쓰기가 없어 무해).
- 검증 실패 400 응답 경로는 트랜잭션 밖에 유지 → 동작 변화 없음.
- 해결: `document.save()` 후 `ApprovalStep` 생성 실패 시 전체 롤백 →
  "under_review인데 결재단계 없음" 같은 불일치(영구 멈춤) 방지.

### 동작 변화 (happy path는 불변, 실패 케이스만 개선)
- 정상 상신: 변화 없음.
- 상신 중 결재단계 생성 실패: (전)반쪽 깨진 문서 영구 멈춤 → (후)롤백·재시도 가능.
- 신규 작성 중 자동저장+상신 동시: (전)2건 생성 → (후)1건.
- R 합의 시 P/O/E 일부만 생성 실패: (전)병렬 path 안 열림 → (후)롤백·재시도.

### 알려진 한계(이번 범위 밖)
- 트랜잭션은 **부분 저장**만 막음. J/O/E 동시 합의 시 **lost-update**
  (둘 다 미완료로 읽어 approved 못 됨)는 `select_for_update` 필요 → 후보 항목.

### 검증 방법
- 프론트(완료): `cd frontend && npx tsc --noEmit` → 신규 에러 0
  (남는 2건은 `tsconfig.json` target=ES5 / moduleResolution deprecation 경고, 기존 이슈).
- 백엔드(대기, **docker 필요** — 현재 세션엔 Django 미설치):
  ```bash
  docker exec -it <backend_container> python manage.py check
  docker exec -it <backend_container> python manage.py test api
  ```
- 수동 회귀 시나리오(`http://localhost:10011`):
  1. 신규 작성 → 임시저장 → 상신: 정상 1건, 결재현황 노출.
  2. 반려된 문서 → 재상신: round+1 PL 단계 생성, 상태 under_review.
  3. (가능하면) 상신 직후 결재현황/이력에 즉시 반영 확인.

---

## 3. 다음 작업 예정 (순서)

1. **[항목 2] step 검증 정합성** — 다음 계획 제시 예정.
2. **[항목 3] 결재/이력 error 상태 처리** — `fetchDocs` / HistoryPage의
   `.catch(()=>setDocs([]))`로 에러가 empty와 구분 안 되는 문제(규칙 J).
3. (후보 검토) lost-update 동시성, JSON 손상 방어.
4. **문서화** — `docs/APPROVAL.md` 신규 작성 + 관련 docs 최신화.

---

*이 파일은 작업 진행에 따라 계속 갱신한다.*
