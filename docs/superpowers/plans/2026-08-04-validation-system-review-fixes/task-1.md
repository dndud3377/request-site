# Task 1: [BLOCKER] 토글 배열의 타입 단언 복원

**작업 디렉터리:** `/Users/mac_wb/codespace/request-site/.claude/worktrees/bridge-cse_01Ueeczx2qjGTBUApYUboKsd` (브랜치 `woobin`). 메인 워크트리가 아니다. 아래 모든 상대 경로는 이 디렉터리 기준이다.

**선행 조건:** Task 0(스냅샷 커밋)이 끝나 있어야 한다.

---

## 문제

`frontend/src/pages/RequestPage/constants.ts:48-49`가 **타입 주석도 `as const`도 없이** 선언돼 있다:

```ts
export const VS_TARGET = 'YES';
export const VS_NONTARGET = 'NO';
```

이런 상수는 *widening literal type*을 가지므로 배열 리터럴에 넣으면 `string`으로 넓혀진다. 그래서 `frontend/src/components/ValidationSystem.tsx:47`의 `[VS_TARGET, VS_NONTARGET]`가 `string[]`로 추론되고 `opt: string`이 된다.

- 54행 `onClick={() => onChange(opt)}` → `onChange`는 `(v: ValidationSystemValue) => void`인데 `ValidationSystemValue`는 `'YES' | 'NO' | 'NA'`(`frontend/src/types/index.ts:242`)라서 `string`이 할당되지 않는다.
- 57행 `{label(opt)}` → `useValidationSystemLabel`의 `(v: ValidationSystemValue) => string`에 대해 같은 오류.

**TS2345 2건.** `frontend/tsconfig.json`이 `strict: true`라 `npm run build`가 실패한다.

**근거:** 이 컴포넌트가 대체한 원본 토글 두 곳(`frontend/src/pages/ApprovalPage.tsx` 구 964-967행, `frontend/src/pages/RequestPage/components/Step2.tsx` 구 108-111행)이 **둘 다 이 배열에 `as const`를 붙이고 있었다.** 리팩터링하면서 빠뜨렸다.

**기각한 대안 — `constants.ts`를 고치는 것:** `VS_TARGET`은 이 파일 밖 여러 곳에서 쓰인다. 상수 선언의 타입을 좁히면 파급 범위가 커지고 규칙 H(요청 범위 최소)에 어긋난다. 문제가 생긴 배열 하나만 좁힌다.

---

**Files:**
- Modify: `frontend/src/components/ValidationSystem.tsx:47`

**Interfaces:**
- Consumes: `VS_TARGET` / `VS_NONTARGET` (`frontend/src/pages/RequestPage/constants.ts:48-49`), `ValidationSystemValue` (`frontend/src/types/index.ts:242`)
- Produces: 없음 (런타임 동작 변화 없음, 컴파일만 통과)

---

- [ ] **Step 1: 현재 코드 확인**

```bash
cd /Users/mac_wb/codespace/request-site/.claude/worktrees/bridge-cse_01Ueeczx2qjGTBUApYUboKsd
sed -n '44,60p' frontend/src/components/ValidationSystem.tsx
```

47행이 이렇게 보여야 한다:

```tsx
      {[VS_TARGET, VS_NONTARGET].map((opt) => {
```

- [ ] **Step 2: 타입 단언 추가**

`frontend/src/components/ValidationSystem.tsx` 47행을 바꾼다.

바꾸기 전:
```tsx
      {[VS_TARGET, VS_NONTARGET].map((opt) => {
```

바꾼 뒤:
```tsx
      {([VS_TARGET, VS_NONTARGET] as const).map((opt) => {
```

`as const`가 붙으면 배열이 `readonly ['YES', 'NO']`로 추론되어 `opt: 'YES' | 'NO'`가 되고, 이는 `ValidationSystemValue`에 할당 가능하다.

- [ ] **Step 3: 타입 체크 실행**

```bash
cd /Users/mac_wb/codespace/request-site/.claude/worktrees/bridge-cse_01Ueeczx2qjGTBUApYUboKsd/frontend
npx tsc --noEmit
```

기대: `ValidationSystem.tsx` 관련 오류 0건.

**`node_modules`가 없어서 실행할 수 없으면:** `npm install`(수 분 소요)을 먼저 시도한다. 그래도 안 되면 **"타입 체크 미실행"이라고 기록하고** 다음 단계로 간다. 통과했다고 쓰지 않는다.

**`npm test`로 대체하지 말 것.** `react-scripts test`는 Babel을 쓰므로 타입 체크를 하지 않는다. 통과해도 이 BLOCKER가 잡혔다는 증거가 되지 못한다.

`ValidationSystem.tsx` 외의 파일에서 오류가 나오면 이 작업과 무관한 기존 문제일 수 있다. **오류 전문을 기록하고 사용자에게 보고한다 — 임의로 고치지 않는다**(규칙 H).

- [ ] **Step 4: 커밋**

```bash
cd /Users/mac_wb/codespace/request-site/.claude/worktrees/bridge-cse_01Ueeczx2qjGTBUApYUboKsd
git add frontend/src/components/ValidationSystem.tsx
git commit -m "fix: ValidationSystemToggle 옵션 배열에 as const 복원

VS_TARGET/VS_NONTARGET 이 widening literal type 이라 배열 리터럴에서 string 으로
넓혀져 onChange/label 호출이 TS2345 로 실패했다. 이 컴포넌트가 대체한 원본 토글
(ApprovalPage/Step2)이 쓰던 단언을 되돌린다."
```
