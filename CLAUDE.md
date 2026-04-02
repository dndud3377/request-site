# CLAUDE.md — 변경 이력

이 파일은 Claude Code가 수행한 주요 변경 사항을 기록합니다.

---

## 필수 참고 파일

새 세션 시작 시 반드시 `PROJECT_CONTEXT.md`를 읽을 것.
이 파일에는 레포지토리에 없는 파일 설명, 환경변수, 백엔드 연동 현황 등 중요한 컨텍스트가 담겨 있다.

---

## 2026-03-14

### — 소개 페이지 삭제 및 RFG 페이지 빈 화면 전환
**파일:** `frontend/src/pages/IntroPage.tsx` (삭제), `frontend/src/pages/RFGPage.tsx`, `frontend/src/App.tsx`, `frontend/src/components/Navbar.tsx`, `frontend/src/locales/ko.json`, `frontend/src/locales/en.json`

- `IntroPage.tsx` 삭제
- `App.tsx`: `/intro` 라우트 제거
- `Navbar.tsx`: 소개 링크 제거
- `RFGPage.tsx`: 타이틀(`<h1>RFG</h1>`)만 남기고 모든 콘텐츠 제거 (프로그램 삽입 예정 공간)
- `ko.json` / `en.json`: `intro` 섹션 및 `nav.intro` 키 제거

### — ko.json 미사용 키 제거
**파일:** `frontend/src/locales/ko.json`

- `home.stat_total`, `home.stat_submitted`, `home.stat_approved`, `home.stat_pending` 제거
- `home.feature_1_title` ~ `home.feature_4_desc` 제거 (HomePage에서 미사용)

---

## 2026-03-13

### 09:47 — ApprovalPage: X표시/C가문 통합 카드 및 C가문 라벨 제거
**파일:** `frontend/src/pages/ApprovalPage.tsx`

- `X표시 변경 여부`와 `이미지 복사 위치`(또는 삭제 안내)를 하나의 카드로 통합, 좌우 분할 레이아웃으로 표시
- `Only C가문 제품`과 `C가문 세부 정보`를 하나의 카드로 통합, 좌우 분할 레이아웃으로 표시
- C가문 세부 정보 형식 변경: `[북] 라인: A / 조합: B / 제품: C` → `[북] A / B / C` (라벨 제거)

---

### 09:35 — 결재 현황 UI 6가지 개선
**파일:** `frontend/src/types/index.ts`, `frontend/src/api/mock.ts`, `frontend/src/pages/RequestPage.tsx`, `frontend/src/pages/ApprovalPage.tsx`

#### 1. 제목에서 날짜 제거 (RequestPage.tsx)
- 자동 생성 제목 형식 변경: `A라인(신규)_조합법A_제품A_조리법1_요청서_2026-03-13` → `A라인(신규)_조합법A_제품A_조리법1_요청서`

#### 2. PL 역할 전체 정보 열람 (ApprovalPage.tsx)
- PL이 결재 현황에서 제목 클릭 시 J-ayer / O-ayer / 뼈찜 탭 포함 모든 상세 정보 열람 가능
- PL 전용 의뢰 기본 정보 카드 상단 표시 (의뢰자, 부서, 제품명, 설명 등)

#### 3. 합의/반려 이유 입력 및 표시 (types/index.ts, mock.ts, ApprovalPage.tsx)
- `ApprovalStepFrontend` 타입에 `comment?: string` 필드 추가
- `mockApproveStep`, `mockRejectStep` 함수에 `comment` 파라미터 추가
- 합의/반려 버튼 클릭 시 이유 입력 모달 표시
- 반려/합의 이유를 상태 배지 옆 및 결재 흐름 노드 하단에 표시

#### 4. 상세 정보 레이아웃 재구성 (ApprovalPage.tsx)
새로운 표시 순서:
1. 원본 위치 / 원본 제품 이름 (isR 또는 isJ)
2. 지도 편차 변경 / 예외 구역 변경 (isR 또는 isO)
3. X표시 변경 여부 + 이미지 복사 위치 (isR)
4. Only C가문 제품 + C가문 세부 정보 (isR)
5. 뼈찜 조합 영역 (isJ 또는 isO) — 별도 행
6. 분리 진행 여부 / T가문 적용 / 주력 제품 변경 / 20주년 제품 (isR)
7. 특이사항 / 변경 요청 목적 (isO 또는 MASTER)
8. 설탕 추가 (isE 또는 MASTER)

#### 5. 의뢰서 작성 조건부 항목 인라인 표시 (RequestPage.tsx)
- `Only C가문 제품` 선택 시 CFamilyRows가 select 옆에 인라인으로 표시
- `X표시 변경 여부` 선택 시 관련 서브 필드가 같은 form-group 안에 표시

#### 6. 상세 정보 칩 스타일 개선 (ApprovalPage.tsx)
- 기본 정보 섹션과 동일한 chip 카드 스타일 적용
- 행별 `display: flex; gap: 8px; flex-wrap: wrap` 레이아웃

---

## 2026-03-13 (이전 세션)

### 06:34 — 합의 처리 후 모달 자동 닫기
**파일:** `frontend/src/pages/ApprovalPage.tsx`
- 합의(approve) 완료 후 상세 모달 자동으로 닫히도록 처리

### 06:30 — 의뢰자 이름 자동 설정 및 우선순위 컬럼 제거
**파일:** `frontend/src/pages/ApprovalPage.tsx`, 관련 페이지
- 의뢰자 이름을 로그인된 사용자 정보에서 자동 설정
- 결재 현황 목록에서 우선순위 컬럼 제거

### 05:42 — 결재 현황 모달 UI 2차 개선
**파일:** `frontend/src/pages/ApprovalPage.tsx`
- 모달 내 상세 정보 레이아웃 2차 개선

### 04:55 — 결재 현황 모달 UI 개선
**파일:** `frontend/src/pages/ApprovalPage.tsx`
- 모달 너비 확장, 스크롤 처리, 화살표 네비게이션 추가

### 03:27 — 역할 기반 결재 권한 시스템 구현
**파일:** `frontend/src/pages/ApprovalPage.tsx`, 관련 파일
- TE_R / TE_J / TE_O / TE_E 역할별 열람/결재 권한 분리
- 각 역할이 담당 단계에서만 합의/반려 버튼 표시

---

## 2026-03-12

### 08:34 — 다단계 결재 워크플로우 구현 (Mock)
**파일:** `frontend/src/api/mock.ts`, `frontend/src/pages/ApprovalPage.tsx`
- R → J/O (병렬) → E 순서의 결재 단계 구현
- 결재 흐름 시각화 컴포넌트 (`ApprovalFlow`) 추가

### 02:08 — 의뢰서 제목 형식 변경
**파일:** `frontend/src/pages/RequestPage.tsx`
- 제목 자동 생성 형식 정의: `{라인}({요청목적})_{조합법}_{제품이름}_{조리법}_요청서`

---

## 2026-03-11

### 09:22 — 불필요 코드 삭제 및 컴포넌트 정리
**파일:** 다수
- `FormSelect` 컴포넌트 통합
- CSS 유틸리티 정리
- `CFamilyRow` 컴포넌트 통합

### 06:37 — C가문/X표시 전체행 및 필드 배치 개선
**파일:** `frontend/src/pages/RequestPage.tsx`
- C가문, X표시를 전체 너비 행으로 처리
- 분리 진행 여부 위치 조정
- 지도편차/예외구역 고정 비율 레이아웃

### 06:07 — X표시/20주년/T가문 행 레이아웃 개편
**파일:** `frontend/src/pages/RequestPage.tsx`

### 05:16 — Only C가문 YES 시 북쪽/중간/남쪽 인라인 3행 레이아웃
**파일:** `frontend/src/pages/RequestPage.tsx`
- C가문 선택 시 지역별 상세 입력 행 표시

### 03:25 — 지도편차/예외구역/분리 행 레이아웃 통합
**파일:** `frontend/src/pages/RequestPage.tsx`

### 02:56 — 요청목적 full-width 및 지도편차 인라인 행
**파일:** `frontend/src/pages/RequestPage.tsx`

### 01:46 — 흐름 테이블 헤더 정렬 및 위치 드롭다운 변환
**파일:** `frontend/src/pages/RequestPage.tsx`

### 00:29 — 복사 섹션 flex row 드롭다운, 흐름 차트 컬럼 추가
**파일:** `frontend/src/pages/RequestPage.tsx`

---

## 2026-03-10

### 17:36 — 요청서 항목 변경
**파일:** `frontend/src/pages/RequestPage.tsx`
- 사용자 직접 수정: 요청서 필드 항목 변경

### 16:51 — README 업데이트

### 16:46 — 전체 색상 밝게 수정, 의뢰자 정보 폼 삭제
**파일:** 스타일 관련 파일, `frontend/src/pages/RequestPage.tsx`
- 화사한 밝은 색상 테마로 변경
- 의뢰서 작성 폼에서 의뢰자 정보 섹션 제거

### 07:36 — 밝은 파란색 테마 적용
**파일:** CSS 파일
- bright blue light 테마로 전환

### 05:59 — TypeScript wireframe으로 전환
**파일:** 전체
- 백엔드/DB 없이 TypeScript + Mock API만으로 동작하는 구조로 리팩토링

### 02:29 — 초기 구현
**파일:** 전체
- 제품 소개 맵 의뢰 시스템 풀스택 초기 구현
