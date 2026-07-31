# Validation System 사내 용어 단일 소스화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사내 정식 용어를 `ko.json` / `en.json` 의 `request.validation_system` 한 줄에만 적으면 웹페이지 전반(작성 화면·상세보기·MASK 결재 모달·전체 가이드)에 자동 반영되게 한다.

**Architecture:** 현재 "Validation System" 이라는 가명이 3개의 번역 문자열에 각각 하드코딩돼 있어, 용어를 바꾸려면 3곳을 모두 고쳐야 한다. i18next 의 **중첩 참조(nesting)** 문법 `$t(request.validation_system)` 을 써서 파생 문구들이 용어 키를 런타임에 참조하게 만든다. 치환은 번역 시점에 일어나므로 **컴포넌트(`t()` 호출부)는 한 줄도 수정하지 않는다.** 회귀 테스트로 "용어 값만 바꾸면 파생 문구에 전파된다"를 고정한다.

**Tech Stack:** i18next 23.10.0 (중첩 참조 기본 활성), react-i18next 14.1.0, TypeScript 4.9.5 (strict), Jest (react-scripts 5).

**작업 디렉터리:** `/Users/mac_wb/codespace/request-site/.claude/worktrees/woobin-fresh` (git worktree). 이 문서의 모든 경로는 이 디렉터리 기준 상대 경로다. 명령의 `cd frontend` 도 여기서 출발한다. 원본 저장소(`/Users/mac_wb/codespace/request-site`)로 이동하지 말 것.

## Global Constraints

- **규칙 G (i18n)**: `ko.json` / `en.json` 에 키를 **반드시 동시에** 추가·수정한다. 하나만 고치는 것은 금지.
- **규칙 G (i18n)**: 프론트엔드의 모든 사용자 노출 텍스트는 `t()` 를 통한다. 하드코딩 금지.
- **규칙 I (품질)**: TypeScript `any` 사용 금지. `console.log` / 주석 처리된 dead code 금지. 매직 스트링은 상수로 분리.
- **규칙 E (파일 관리)**: 여러 파일 수정 시 **파일별로 개별 커밋**한다.
- **규칙 H (범위)**: 요청하지 않은 기능 추가·리팩토링 금지. 변경은 요청 범위 내 최소한으로 유지.
- **변수·상수·키 이름은 가명(`validation_system`, `VS_TARGET`, `autoValidationSystem` …)을 그대로 둔다.** 사용자에게 보이지 않으므로 교체 대상이 아니다.
- **`plel` 은 가명이 아니라 실제 사내 값이다.** 판정 로직(`VALIDATION_KEYWORD`, `RequestDocument.VALIDATION_KEYWORD`)이 J-layer `pp` 컬럼 데이터와 비교하는 값이므로 번역·치환 대상이 아니며, 가이드 문구의 `plel` 표기도 그대로 둔다.
- **백엔드 `backend/api/views.py:494` 의 `'유효하지 않은 Validation System 값입니다.'` 는 손대지 않는다.** UI 가 `YES`/`NO` 만 보내므로 요청을 직접 위조할 때만 노출되는 방어 메시지라, 용어 노출 위험 대비 수정 가치가 낮다고 판단해 범위에서 제외했다.

## 검토했다가 기각한 대안

이 문서를 처음 읽는 사람이 같은 제안을 다시 하지 않도록, 실제로 비교한 선택지와 기각 사유를 남긴다.

| 대안 | 내용 | 기각 사유 |
|---|---|---|
| **A. 호출부 interpolation** | 문구를 `"{{term}} 확정"` 으로 두고 호출부에서 `t('approval.validation_system_confirm', { term: t('request.validation_system') })` 로 값을 넘긴다 | 컴포넌트 3개(`ApprovalPage.tsx`, `ApprovalRouteDiagram.tsx` 등)를 수정해야 하고, 앞으로 문구를 추가할 때마다 호출부에서 인자 넘기는 것을 **잊으면 조용히 깨진다**. 중첩 참조(`$t()`)는 호출부를 아예 건드리지 않아 이 실수 자체가 불가능하다. |
| **B. TS 상수 모듈** | `VALIDATION_TERM = 'Validation System'` 을 `constants.ts` 에 두고 문자열 조합 | 규칙 G(모든 노출 텍스트는 i18n) 위반이고, 언어별로 다른 용어(ko/en)를 담을 수 없다. |
| **C. 각 문구를 그냥 개별 수정** | 지금처럼 3곳에 용어를 하드코딩해 두고, 사내에서 3곳을 다 고친다 | 사용자의 요구가 "**적어준 사내 용어가 웹페이지 전반에 적용**"이다. 교체 지점이 여러 곳이면 하나를 빠뜨렸을 때 화면마다 용어가 달라진다. |
| **D. 변수·키 이름도 사내 용어로 개명** | `validation_system` → 사내 용어 기반 식별자로 rename | 사용자가 명시적으로 제외했다(변수명은 화면에 안 보이므로 가명 유지). 게다가 백엔드 `detail` JSON 키까지 바뀌어 기존 문서와 호환이 깨진다. |
| **E. `plel` 도 i18n 처리** | 판정 키워드를 번역 키로 뺀다 | `plel` 은 표시용 문구가 아니라 **로직이 비교하는 데이터 값**이다. i18n 으로 빼면 언어를 바꿀 때 판정 결과가 달라지는 심각한 버그가 된다. 확인 결과 `plel` 은 실제 사내 값이라 애초에 교체 대상도 아니다. |

**채택: 중첩 참조(`$t()`)** — 호출부 무수정, 언어별 값 유지, 교체 지점 1곳, 회귀 테스트로 고정 가능.

---

## File Structure

| 파일 | 역할 | 변경 |
|---|---|---|
| `frontend/src/locales/ko.json` | 한국어 번역 리소스 | 수정 — 값 2개를 `$t()` 참조로 교체 |
| `frontend/src/locales/en.json` | 영어 번역 리소스 | 수정 — 값 2개를 `$t()` 참조로 교체 |
| `frontend/src/locales/terminology.test.ts` | 용어 단일 소스 회귀 테스트 | **신규** — 전파 여부를 고정. 로케일 리소스 옆에 두어 함께 바뀌게 한다 |
| `docs/REQUEST.md` | 의뢰서 기능 참조 문서 | 수정 — 사내 용어 교체 절차 1개 항목 추가 |

**변경하지 않는 파일 (의도적):**
`Step2.tsx`, `PagedDetailView.tsx`, `ApprovalPage.tsx`, `ApprovalRouteDiagram.tsx` — 전부 이미 `t()` 를 통하므로 중첩 참조 도입 후에도 수정이 필요 없다. 이 "호출부 무수정"이 이 접근을 고른 이유다.

### 현재 용어가 사용자에게 노출되는 전 지점 (조사 완료)

| 키 | 화면 | 현재 |
|---|---|---|
| `request.validation_system` | 작성 3단계 J-layer 표 상단 라벨 / 상세보기 J-layer 탭 라벨 | ✅ 이미 단일 소스 |
| `approval.validation_system_confirm` | MASK(E) 결재 모달 제목 | ⚠️ 값에 용어 하드코딩 → Task 1 |
| `approval.route_diagram.note_e` | 전체 가이드 첫 단계 결재 경로 다이어그램 주석 | ⚠️ 값에 용어 하드코딩 → Task 1 |

나머지 코드 내 "Validation System" 등장은 전부 **주석·변수명**이라 화면에 보이지 않는다 (`types/index.ts`, `helpers.ts`, `constants.ts`, `client.ts`, `ApprovalPage.tsx`, `RequestPage/index.tsx`, `PagedDetailView.tsx`, 백엔드 `models.py`/`views.py`/`tests.py`).

---

## Task 1: 용어 참조 단일화 + 전파 회귀 테스트

**Files:**
- Create: `frontend/src/locales/terminology.test.ts`
- Modify: `frontend/src/locales/ko.json:436` (`approval.validation_system_confirm`), `frontend/src/locales/ko.json:468` (`approval.route_diagram.note_e`)
- Modify: `frontend/src/locales/en.json:437` (`approval.validation_system_confirm`), `frontend/src/locales/en.json:468` (`approval.route_diagram.note_e`)

> 줄 번호는 2026-07-31 기준 참고값이다. 키 경로로 찾아 수정할 것. 특히 `route_diagram` 은 `guide` 가 아니라 **`approval` 하위**다.

**Interfaces:**
- Consumes: 없음 (기존 로케일 리소스만 사용)
- Produces: `frontend/src/locales/terminology.test.ts` 의 모듈 상수 — Task 2 문서가 이 파일을 "회귀 방지 장치"로 참조한다.
  - `TERM_KEY = 'request.validation_system'`
  - `DERIVED_KEYS = ['approval.validation_system_confirm', 'approval.route_diagram.note_e']`
  - `PLACEHOLDER_TERM = 'Validation System'`

### 배경 지식 (이 코드베이스를 처음 보는 사람용)

- **i18next 중첩 참조**: 번역 값 안에 `$t(다른.키)` 를 쓰면 번역 시점에 그 키의 값으로 치환된다. `t()` 호출부에 인자를 넘길 필요가 없다. 이 프로젝트 설정(`frontend/src/i18n.ts`)은 `keySeparator` / `nsSeparator` 를 건드리지 않아 기본값(`.` / `:`)이므로 `$t(request.validation_system)` 이 그대로 동작한다. **동작은 실측으로 확인됐다.**
- **`frontend/src/types/i18n.d.ts`** 가 `CustomTypeOptions.resources.translation = typeof ko` 로 선언돼 있어, `t()` 의 키 인자는 **ko.json 에 실재하는 키의 리터럴 유니온**으로 타입 제한된다. 따라서 테스트에서 키 배열을 만들 때 **반드시 `as const`** 를 붙여야 리터럴 타입이 유지돼 컴파일된다. 그냥 `string[]` 이면 타입 에러가 난다.
- **`en as typeof ko` 캐스팅은 쓰지 말 것.** ko 는 927개, en 은 926개 키로 `voc.page_other` 하나가 어긋나 있어(사전 존재 이슈) 캐스팅이 컴파일되지 않는다. 아래 테스트는 최소 인터페이스 + 제네릭으로 이 문제를 우회한다.
- **테스트 실행**: 이 저장소는 Create React App(`react-scripts`) 기반이다. `frontend` 디렉터리에서 실행한다. `node_modules` 가 없으면 먼저 `npm ci`.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`frontend/src/locales/terminology.test.ts` 를 새로 만들고 아래를 그대로 넣는다.

```ts
import { createInstance } from 'i18next';
import ko from './ko.json';
import en from './en.json';

/** 사내 정식 용어가 적히는 단일 소스 키 — 용어 교체는 여기 한 곳만 고친다. */
const TERM_KEY = 'request.validation_system' as const;

/** 위 용어를 `$t()` 로 참조해야 하는 파생 문구들 */
const DERIVED_KEYS = [
  'approval.validation_system_confirm',
  'approval.route_diagram.note_e',
] as const;

/** 저장소에 커밋돼 있는 가명. 용어를 바꾼 뒤 파생 문구에 이 문자열이 남아 있으면 하드코딩된 것이다. */
const PLACEHOLDER_TERM = 'Validation System';

/** 용어 교체 시뮬레이션에 쓰는 센티넬 — 어떤 실제 문구와도 겹치지 않는 값 */
const SENTINEL_TERM = '__사내정식용어__';

/** 이 테스트가 필요로 하는 최소 형태. ko/en 의 전체 키 집합이 달라도 둘 다 만족한다. */
interface TermResource {
  request: { validation_system: string };
}

/** 주어진 리소스만으로 격리된 i18next 인스턴스를 만든다(앱 싱글턴을 오염시키지 않는다). */
const makeI18n = <T extends TermResource>(resource: T) => {
  const instance = createInstance();
  instance.init({
    lng: 'test',
    resources: { test: { translation: resource } },
    interpolation: { escapeValue: false },
    initImmediate: false,
  });
  return instance;
};

/** 용어 키의 값만 바꾼 리소스 사본을 만든다. */
const withTerm = <T extends TermResource>(resource: T, term: string): T => ({
  ...resource,
  request: { ...resource.request, validation_system: term },
});

const describeLocale = (label: string, resource: TermResource) => {
  describe(`${label} — 사내 용어 단일 소스`, () => {
    it('파생 문구가 용어 키의 값을 그대로 포함한다', () => {
      const i18n = makeI18n(resource);
      const term = i18n.t(TERM_KEY);
      expect(term).not.toBe(TERM_KEY); // 키가 실재하는지(미존재 시 i18next 는 키를 그대로 반환)
      DERIVED_KEYS.forEach((key) => {
        expect(i18n.t(key)).toContain(term);
      });
    });

    it('용어 값만 바꾸면 파생 문구에 전파되고 옛 용어는 남지 않는다', () => {
      const i18n = makeI18n(withTerm(resource, SENTINEL_TERM));
      DERIVED_KEYS.forEach((key) => {
        const text = i18n.t(key);
        expect(text).toContain(SENTINEL_TERM);
        expect(text).not.toContain(PLACEHOLDER_TERM);
      });
    });
  });
};

describeLocale('ko.json', ko);
describeLocale('en.json', en);
```

**왜 두 번째 테스트가 핵심인가**: 첫 번째만 있으면 "문구에 용어가 하드코딩돼 있어도" 우연히 통과한다(문자열이 같으므로). 두 번째는 용어 값을 바꿔치기한 뒤 파생 문구가 따라 바뀌는지를 보므로 **하드코딩을 확실히 잡는다**. 그리고 `PLACEHOLDER_TERM` 검사를 제외하면 용어 문자열에 의존하지 않으므로, 사내 용어로 교체한 뒤에도 그대로 통과한다.

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
cd frontend
CI=true npx --no-install react-scripts test --watchAll=false --testPathPattern=terminology
```

기대: **FAIL 4건 중 2건**(`용어 값만 바꾸면 …` ko/en 각 1건).
실패 메시지는 `expect(received).toContain(expected)` 형태로, `approval.validation_system_confirm` 이 `__사내정식용어__` 를 포함하지 않는다고 나온다 — 지금은 값에 "Validation System" 이 하드코딩돼 있기 때문이다.

> 첫 번째 테스트(`파생 문구가 …`)는 지금도 통과한다. 하드코딩된 문자열이 용어 값과 우연히 같기 때문이며, 이것이 두 번째 테스트가 필요한 이유다.

- [ ] **Step 3: `ko.json` 의 값 2개를 참조로 교체한다**

`approval.validation_system_confirm`:

```diff
-    "validation_system_confirm": "Validation System 확정",
+    "validation_system_confirm": "$t(request.validation_system) 확정",
```

`approval.route_diagram.note_e`:

```diff
-      "note_e": "EUV(E) 단계는 plel(노란 셀) 항목이 있는 경우에만 진행되며, Validation System 대상/비대상 판정이 맞는지 확인합니다.",
+      "note_e": "EUV(E) 단계는 plel(노란 셀) 항목이 있는 경우에만 진행되며, $t(request.validation_system) 대상/비대상 판정이 맞는지 확인합니다.",
```

`plel` 은 실제 사내 값이므로 **그대로 둔다**.

- [ ] **Step 4: `en.json` 의 같은 값 2개를 참조로 교체한다 (규칙 G — 반드시 동시에)**

`approval.validation_system_confirm`:

```diff
-    "validation_system_confirm": "Confirm Validation System",
+    "validation_system_confirm": "Confirm $t(request.validation_system)",
```

`approval.route_diagram.note_e`:

```diff
-      "note_e": "The EUV (E) stage runs only when plel (yellow cell) items are present, and verifies whether the Validation System classification is correct.",
+      "note_e": "The EUV (E) stage runs only when plel (yellow cell) items are present, and verifies whether the $t(request.validation_system) classification is correct.",
```

> `$t(request.validation_system)` 안의 키 경로는 **ko/en 모두 동일**하다. 언어별로 자기 파일의 값이 치환되므로 en 에서도 `request.validation_system` 을 가리키는 것이 맞다.

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

```bash
cd frontend
CI=true npx --no-install react-scripts test --watchAll=false --testPathPattern=terminology
```

기대: **PASS 4건** (`Tests: 4 passed, 4 total`).

- [ ] **Step 6: 타입 체크로 신규 오류가 없는지 확인한다**

```bash
cd frontend
./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"
```

기대: **28** — 이 저장소의 기존 오류 개수와 동일해야 한다(존재하지 않는 i18n 키 5종, `Set` downlevelIteration, `VOCPage` null 등 전부 이 작업과 무관한 선행 오류). 29 이상이면 새 오류가 생긴 것이므로, 아래로 어느 파일인지 확인하고 고친다.

```bash
./node_modules/.bin/tsc --noEmit 2>&1 | grep "terminology"
```

기대: 출력 없음.

- [ ] **Step 7: 전체 프론트 테스트가 깨지지 않았는지 확인한다**

```bash
cd frontend
CI=true npx --no-install react-scripts test --watchAll=false --passWithNoTests
```

기대: `Tests: 16 passed, 16 total` (기존 `helpers.test.ts` 12건 + 신규 4건).

- [ ] **Step 8: 파일별로 개별 커밋한다 (규칙 E)**

```bash
cd "$(git rev-parse --show-toplevel)"

git add frontend/src/locales/terminology.test.ts
git commit -m "$(cat <<'EOF'
test(i18n): 사내 용어가 파생 문구까지 전파되는지 회귀 테스트 추가

용어 키(request.validation_system)의 값만 센티넬로 바꿔치기한 뒤
MASK 결재 모달 제목·가이드 경로 주석이 따라 바뀌는지 검증한다.
누가 문구에 용어를 다시 하드코딩하면 이 테스트가 잡는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"

git commit -o frontend/src/locales/ko.json -m "$(cat <<'EOF'
refactor(i18n): 용어가 박힌 문구를 $t(request.validation_system) 참조로 (ko)

사내 정식 용어를 request.validation_system 한 줄만 고쳐 반영할 수 있게 한다.
호출부(t()) 는 그대로 두고 번역 시점에 치환된다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"

git commit -o frontend/src/locales/en.json -m "$(cat <<'EOF'
refactor(i18n): 용어가 박힌 문구를 $t(request.validation_system) 참조로 (en)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 사내 용어 교체 절차 문서화

**Files:**
- Modify: `docs/REQUEST.md` — `### 추가 변경 이력 (2026-07 — Validation System 대상/비대상)` 섹션의 **`- **레거시 문서**: …` 항목 바로 뒤**에 새 항목을 추가

**Interfaces:**
- Consumes: Task 1 이 만든 `frontend/src/locales/terminology.test.ts` 와 `$t(request.validation_system)` 참조 구조
- Produces: 없음 (문서 전용)

### 배경 지식

`docs/REQUEST.md` 의 해당 섹션은 이미 `validation_system` / `validation_system_submitted` 키 표, 3상태(`YES`/`NO`/`NA`)의 의미, 자동 판정, 상신 UI, MASK 확정, 레거시 문서 폴백을 문단 리스트(`- **제목**: 내용`)로 다루고 있다. 같은 형식을 따른다.

- [ ] **Step 1: 절차 항목을 추가한다**

`docs/REQUEST.md` 에서 `- **레거시 문서**: 두 키가 없는 문서는 …` 로 시작하는 줄을 찾아, **그 줄 바로 다음**에 아래를 추가한다.

```markdown
- **사내 용어 교체 (⚠️ 여기 한 곳만 고친다)**: 저장소에 커밋된 `Validation System` 은 **가명**이다. 사내 정식 용어로 바꿀 때는 `frontend/src/locales/ko.json` 과 `en.json` 의 **`request.validation_system` 값 한 줄씩**만 고치면 된다. 작성 3단계 J-layer 표 상단 라벨, 상세보기 J-layer 탭 라벨, MASK(E) 결재 모달 제목(`approval.validation_system_confirm`), 전체 가이드 결재 경로 주석(`approval.route_diagram.note_e`)이 모두 따라 바뀐다 — 뒤의 두 문구는 값 안에서 i18next 중첩 참조 `$t(request.validation_system)` 로 이 키를 가리키기 때문이다.
  - **다른 문구에 용어를 직접 쓰지 말 것.** 새 문구가 필요하면 반드시 `$t(request.validation_system)` 으로 참조한다. 하드코딩하면 `frontend/src/locales/terminology.test.ts` 가 실패한다.
  - **변수·상수·키 이름(`validation_system`, `VS_TARGET`, `autoValidationSystem` 등)은 가명 그대로 둔다.** 사용자에게 보이지 않는다.
  - **`plel` 은 가명이 아니라 실제 사내 값**이라 교체 대상이 아니다(`VALIDATION_KEYWORD`, `RequestDocument.VALIDATION_KEYWORD`).
  - 백엔드 `views.py` 의 400 에러 메시지 `'유효하지 않은 Validation System 값입니다.'` 는 i18n 밖이라 자동 반영되지 않는다. UI 가 `YES`/`NO` 만 보내므로 요청을 직접 위조할 때만 노출되는 방어 메시지다.
```

- [ ] **Step 2: 문서에 깨진 표기가 없는지 눈으로 확인한다**

```bash
sed -n '/### 추가 변경 이력 (2026-07 — Validation System/,/^### /p' docs/REQUEST.md
```

기대: 새 항목이 `- **레거시 문서**: …` 다음에 있고, 하위 4개 항목이 2칸 들여쓰기로 붙어 있다. 섹션 끝의 다음 `###` 헤더를 침범하지 않는다.

- [ ] **Step 3: 커밋한다**

```bash
cd "$(git rev-parse --show-toplevel)"
git commit -o docs/REQUEST.md -m "$(cat <<'EOF'
docs(request): 사내 용어 교체 절차 명시 — ko/en 한 줄만 고치면 전파

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 완료 후 수동 검증 (규칙 C-2-1)

Task 1·2 를 모두 마친 뒤, **실제로 용어를 바꿔보고 원복**해서 전파를 눈으로 확인한다. 개발 서버(`http://localhost:10011`)에서 진행한다.

**준비 — 용어를 임시로 바꾼다**

`frontend/src/locales/ko.json` 의 `request.validation_system` 값을 `"검증체계TEST"` 로 바꾸고 저장한다(핫 리로드). 다른 곳은 건드리지 않는다.

**시나리오 1 — 작성 화면 라벨**
1. 상단 메뉴 `의뢰서 작성` → 위저드 3단계(J-layer 표)로 이동
2. ✅ 성공: 표 제목 우측 라벨이 **"검증체계TEST"** 로 표시된다
3. ❌ 실패: "Validation System" 이 그대로면 라벨이 다른 키를 쓰고 있는 것 — `Step2.tsx` 의 `t('request.validation_system')` 호출을 확인

**시나리오 2 — MASK(E) 결재 모달 제목 (중첩 참조가 실제로 동작하는지)**
1. J-layer `pp` 에 `plel` 이 포함된 의뢰서를 상신 → PL 합의 → R 담당자 지정·합의로 병렬 단계까지 진행
2. TE_E(MASK) 계정으로 로그인 → `결재 현황` → 해당 의뢰서 행 클릭 → 합의 모달 열기
3. ✅ 성공: 모달 안 확정 토글 제목이 **"검증체계TEST 확정"** 으로 뜬다
4. ❌ 실패: "Validation System 확정" 이 그대로면 `approval.validation_system_confirm` 이 아직 하드코딩 상태다

**시나리오 3 — 전체 가이드 경로 다이어그램 주석**
1. 상단 메뉴에서 `전체 가이드` 진입 → **첫 단계(결재 경로 다이어그램)**
2. ✅ 성공: 다이어그램 아래 주석이 **"EUV(E) 단계는 plel(노란 셀) 항목이 있는 경우에만 진행되며, 검증체계TEST 대상/비대상 판정이 맞는지 확인합니다."** 로 뜬다
3. ✅ `plel` 은 그대로 남아 있어야 한다(실제 사내 값이므로)

**시나리오 4 — 상세보기 J-layer 탭 라벨**
1. `결재 현황` 또는 `이력` 에서 아무 의뢰서 행 클릭 → 상세 → **`J-layer` 탭**
2. ✅ 성공: 표 위 라벨이 **"검증체계TEST"**, 옆 뱃지는 `대상`/`비대상`/`해당없음` 중 하나

**시나리오 5 — 영어 전환**
1. 상단 언어 토글로 `EN` 전환 (또는 `en.json` 의 값도 `"Verification TEST"` 로 바꾼 뒤 확인)
2. ✅ 성공: MASK 모달 제목이 **"Confirm Verification TEST"**, 가이드 주석이 **"… whether the Verification TEST classification is correct."**

**정리 — 반드시 원복**

`ko.json` / `en.json` 의 `request.validation_system` 값을 원래대로(`"Validation System"`) 되돌리고 `git diff` 로 잔여 변경이 없는지 확인한다.

```bash
git diff --stat frontend/src/locales/
```

기대: 출력 없음.

---

## 잠재 이슈 / 주의사항 (규칙 C-3)

- **마이그레이션·환경변수·CORS 변경 없음.** 번역 리소스와 문서만 바뀐다.
- **`$t()` 참조가 깨지는 경우**: `request.validation_system` 키를 지우거나 이름을 바꾸면 i18next 가 치환에 실패해 파생 문구에 `$t(request.validation_system)` 이 **문자 그대로** 노출된다. Task 1 의 테스트가 이를 잡는다(`toContain(term)` 실패).
- **`escapeValue: false`**: `frontend/src/i18n.ts` 가 이미 이 설정이라 사내 용어에 `&`, `<` 같은 문자가 들어가도 이스케이프되지 않는다. 반대로 말하면 용어에 HTML 을 넣으면 안 된다(현재 코드는 `t()` 결과를 JSX 텍스트로만 쓰므로 실제 위험은 없다).
- **선행 이슈 (이 작업 범위 밖, 규칙 G 에 따라 보고만 함)**:
  - `ko.json` 에만 있고 `en.json` 에 없는 키 1개: **`voc.page_other`**
  - ko/en 양쪽에 **없는데 코드가 호출하는** 키 5개: `request.btn_all_o`, `request.btn_all_x`, `request.btn_reset`, `request.btn_all_new`, `request.btn_all_copy` (`Step2.tsx:153-161`, `Step3.tsx:201-209`) — 현재 `tsc` 오류 28건 중 11건의 원인이며, 화면에는 키 문자열이 그대로 노출됐을 가능성이 있다.
  - 둘 다 이번 요청 범위가 아니라 **손대지 않았다**. 별도 작업으로 처리할지 판단이 필요하다.
