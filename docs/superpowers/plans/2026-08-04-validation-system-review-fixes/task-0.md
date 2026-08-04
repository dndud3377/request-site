# Task 0: 리뷰 대상 스냅샷 커밋

**작업 디렉터리:** `/Users/mac_wb/codespace/request-site/.claude/worktrees/bridge-cse_01Ueeczx2qjGTBUApYUboKsd` (브랜치 `woobin`). 메인 워크트리가 아니다. 아래 모든 상대 경로는 이 디렉터리 기준이다.

**왜 하는가:** 워크트리에 커밋이 0개고 stash도 없다(`434 insertions(+), 181 deletions(-)`가 전부 uncommitted). 지금 수정을 시작하면 리뷰가 본 상태로 복귀할 방법이 사라진다.

**Files:**
- Modify: 없음 (커밋만)

**Interfaces:**
- Consumes: 없음
- Produces: `woobin` 브랜치에 커밋 5개. 이후 모든 태스크가 이 위에 쌓인다.

**주의:** 이 커밋들에는 **알려진 빌드 실패(Task 1이 고칠 TS2345)가 포함**된다. 의도된 것이다. `woobin`은 push되지 않은 로컬 브랜치이며, 목적은 "리뷰가 본 정확한 트리"를 보존하는 것이다.

---

- [ ] **Step 1: 워크트리와 상태 확인**

```bash
cd /Users/mac_wb/codespace/request-site/.claude/worktrees/bridge-cse_01Ueeczx2qjGTBUApYUboKsd
git status --short
git rev-parse --abbrev-ref HEAD
git log --oneline -1
```

기대:
- 브랜치가 `woobin`
- `git log --oneline -1`이 `0cd18a6`
- 수정 15개(` M`) + untracked 1개(`?? frontend/src/components/ValidationSystem.tsx`)

**다르면 멈추고 사용자에게 보고한다.** 특히 `git log`가 `0cd18a6`이 아니면 누군가 이미 작업했다는 뜻이므로 진행하지 않는다.

- [ ] **Step 2: UI 버그 수정분 커밋**

```bash
git add frontend/src/components/ValidationSystem.tsx frontend/src/styles/global.css frontend/src/pages/RequestPage/components/Step2.tsx
git commit -m "fix: Validation System 토글·chip 을 repo 표준 badge 관용구로 재설계

미정의 CSS 변수 var(--primary) 참조 3곳이 invalid at computed-value time 이 되어
배경이 transparent 로 계산됐고, 흰 배경에 흰 글씨가 되어 대상/비대상이 보이지 않았다.
변수를 정의하는 대신 global.css 의 .badge-* 와 같은 관용구로 다시 그린다.
대상=warning / 비대상=info / 해당없음=회색."
```

- [ ] **Step 3: 백엔드 커밋**

```bash
git add backend/api/views.py backend/api/mailer.py backend/api/tests.py
git commit -m "feat: Validation System 판정 주체를 상신자로 단일화

- POST /api/documents/<id>/validation-system/ 신설 (상신자·MASTER, 진행 중, E 통과 전)
- E 합의 후 값 변경 시 E 단계만 되감기 (EV step 은 삭제하지 않고 action 만 복귀)
- approve_step 의 validation_system 수용 제거
- E/EV 반려를 '수정 요청'으로 대체 (status·round 불변, 메일만)
- revision_requested 메일 이벤트 추가 (마이그레이션 불필요)"
```

- [ ] **Step 4: 프론트 연결 커밋**

```bash
git add frontend/src/pages/ApprovalPage.tsx frontend/src/components/PagedDetailView.tsx frontend/src/api/client.ts frontend/src/types/index.ts
git commit -m "feat: 상세보기에 상신자 전용 Validation System 토글 연결

- 상신자 본인에게만 토글 활성화, 그 외에는 읽기 전용 badge
- 합의 모달의 MASK 확정 토글 삭제, approveStep 의 validationSystem 인자 제거
- E/EV 결재 화면의 반려 버튼을 '수정 요청'으로 교체"
```

- [ ] **Step 5: i18n 커밋**

```bash
git add frontend/src/locales/ko.json frontend/src/locales/en.json frontend/src/locales/terminology.test.ts
git commit -m "chore(i18n): Validation System 판정 주체 변경에 따른 키 추가·정리"
```

- [ ] **Step 6: 문서 커밋**

```bash
git add docs/APPROVAL.md docs/MAIL.md docs/REQUEST.md
git commit -m "docs: Validation System 상신자 단일화 반영"
```

- [ ] **Step 7: 스냅샷 검증**

```bash
git status --short
git log --oneline -6
```

기대: `git status --short`가 **비어 있다**. 단 `docs/superpowers/plans/2026-08-04-validation-system-review-fixes/` (이 계획서 자체)는 예외이며, 아래 명령으로 따로 커밋한다.

```bash
git add docs/superpowers/plans/2026-08-04-validation-system-review-fixes.md docs/superpowers/plans/2026-08-04-validation-system-review-fixes/
git commit -m "docs: Validation System 리뷰 수정 실행 계획 추가"
```

그 외 파일이 남아 있으면 어느 파일인지 확인하고 Step 2~6의 5개 그룹 중 어디에 속하는지 판단해 추가 커밋한다.
