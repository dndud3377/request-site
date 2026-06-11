# 홈 페이지 (HomePage)

> **파일:** `frontend/src/pages/HomePage.tsx`
> **최초 분석일:** 2026-06-11

---

## 기능 개요

| 기능 | 설명 |
|------|------|
| Hero 섹션 | 의뢰서 작성 / 결재 현황 링크 버튼 |
| 최근 의뢰 현황 | 미결재 의뢰 최대 5건 테이블 표시 |
| 공지 모달 자동 팝업 | `localStorage('last_seen_notice_id')` vs 최신 공지 id 비교 → 미확인 공지 있으면 자동 오픈 |
| 공지 모달 수동 오픈 | Navbar 확성기 클릭 → `window.dispatchEvent('show-notice')` 수신 |
| 공지 열람 | Notice / Release Note 목록 + 우측 패널 상세 표시 |
| 공지 관리 | MASTER 역할만 공지 작성 / 수정 / 삭제 가능 |

---

## 컴포넌트 구조

```
HomePage
├── NoticeManagerModal          (공지 관리 모달)
│   ├── 좌측 패널
│   │   ├── 탭 (all / release_note / notice)
│   │   ├── 공지 목록 (filtered)
│   │   └── [MASTER] 공지 작성 버튼
│   └── 우측 패널
│       ├── detail 뷰: 선택된 공지 상세 + [MASTER] 수정/삭제 버튼
│       └── form 뷰: 공지 작성/수정 폼
│           ├── notice 템플릿: 날짜 + 제목 + 본문
│           └── release_note 템플릿: 날짜 + 제목 + New/Updated/Bugfix 항목
├── Hero 섹션
└── 최근 의뢰 현황 테이블
```

---

## API 연동

| API | 설명 |
|-----|------|
| `noticesAPI.list()` | 전체 공지 목록 조회 (마운트 시 1회) |
| `noticesAPI.create(data)` | 공지 생성 (MASTER) |
| `noticesAPI.update(id, data)` | 공지 수정 (MASTER) |
| `noticesAPI.delete(id)` | 공지 삭제 (MASTER) |
| `documentsAPI.list({})` | 최근 의뢰 목록 조회 |

---

## 상태 관리

```typescript
// HomePage
const [recent, setRecent] = useState<RequestDocument[]>([]);   // 최근 의뢰 5건
const [allNotices, setAllNotices] = useState<AdminNotice[]>([]); // 전체 공지 목록
const [showNoticeModal, setShowNoticeModal] = useState(false);

// NoticeManagerModal
const [tab, setTab] = useState<'all' | 'release_note' | 'notice'>('all');
const [selected, setSelected] = useState<AdminNotice | null>(null);
const [rightPanel, setRightPanel] = useState<'detail' | 'form'>('detail');
```

---

## 공지 자동 팝업 흐름

```
마운트
  → loadNotices() 호출 → setAllNotices(list) 설정
  → .then() 에서 list[0].id > localStorage('last_seen_notice_id')
  → 조건 충족 시 setShowNoticeModal(true)

  ※ React 18 자동 배칭: setAllNotices + setShowNoticeModal이 같은 렌더에서 처리됨
     → 모달 마운트 시점에 notices prop은 이미 데이터가 채워진 상태

모달 닫기
  → localStorage('last_seen_notice_id') = allNotices[0].id 저장
  → window.dispatchEvent('notice-read') 발송 (Navbar 뱃지 제거용)
```

---

## 버그 분석 이력

### 2026-06-11

---

#### [HP-01] `StepOption` 미정의 타입 — **✅ 수정 완료**

| 항목 | 내용 |
|------|------|
| 파일 | `frontend/src/api/client.ts:13`, `:521-522` |
| 심각도 | 🔴 컴파일 에러 |
| 발견 경위 | 홈 화면 분석 중 `client.ts` import 섹션에서 발견 |

**문제:**
```typescript
// client.ts - types에 존재하지 않는 타입을 import
import { StepOption } from '../types'; // ❌ types/index.ts에 정의 없음

getBbExternalData: (...): Promise<StepOption[]> => {
  return get<{ options: StepOption[] }>(...);
};
```

**원인:** `types/index.ts`에 정의된 타입은 `PhotoStepOption`인데 이름을 잘못 참조함. `RequestPage.tsx`에서 `bbExternalData`의 타입이 `PhotoStepOption[][]`로 이미 올바르게 선언되어 있어 불일치 확인.

**수정:**
```typescript
// before
import { StepOption } from '../types';
getBbExternalData: (...): Promise<StepOption[]>

// after
import { PhotoStepOption } from '../types';
getBbExternalData: (...): Promise<PhotoStepOption[]>
```

**커밋:** `a12b8cb` — fix: StepOption 미정의 타입 제거, getBbExternalData 반환 타입을 PhotoStepOption으로 수정

---

#### [HP-02] `useEffect` 의존성 누락 — 초기 자동 선택 — **⏸ 보류**

| 항목 | 내용 |
|------|------|
| 파일 | `frontend/src/pages/HomePage.tsx:58-62` (`NoticeManagerModal` 내부) |
| 심각도 | 🟡 이론적 취약점 |

**문제 코드:**
```typescript
useEffect(() => {
  if (filtered.length > 0 && !selected) {
    setSelected(filtered[0]);
  }
}, []); // filtered를 읽지만 의존성 배열이 빈 배열
```

**보류 근거:**
모달 오픈 경로 두 가지 모두 `notices`가 먼저 로드된 뒤 모달이 열림.
- 자동 팝업: `loadNotices().then(() => setShowNoticeModal(true))` — React 18 자동 배칭으로 `setAllNotices` + `setShowNoticeModal`이 동일 렌더에서 처리됨
- 확성기 클릭: 초기 로드 이후 클릭 → `allNotices` 이미 존재

따라서 `NoticeManagerModal` 마운트 시 `notices` prop은 항상 데이터가 채워진 상태이며 빈 배열로 마운트되는 경우가 실제로 발생하지 않음.

**재검토 트리거:**
- React 버전 업그레이드 시 배칭 동작 변경 가능성
- 확성기 클릭 이벤트가 페이지 진입 직후(API 응답 전)에 발생하는 경우 (극단적 엣지케이스)

---

#### [HP-03] `useEffect` 의존성 누락 — 탭 전환 stale closure — **⏸ 보류**

| 항목 | 내용 |
|------|------|
| 파일 | `frontend/src/pages/HomePage.tsx:65-70` (`NoticeManagerModal` 내부) |
| 심각도 | 🟡 이론적 취약점 |

**문제 코드:**
```typescript
useEffect(() => {
  if (selected && !filtered.find((n) => n.id === selected.id)) {
    setSelected(filtered.length > 0 ? filtered[0] : null);
    setRightPanel('detail');
  }
}, [tab]); // filtered, selected가 의존성에 없음
```

**보류 근거:**
실제로 `selected`가 삭제된 항목을 가리키는 상황 자체가 발생하지 않음. 삭제/저장 경로에서 이미 명시적으로 `selected`를 갱신하고 있기 때문.

```typescript
// handleDelete: 삭제 완료 후 직접 null로 초기화
setSelected(null);
setRightPanel('detail');

// handleSave: 저장 완료 후 직접 최신 항목으로 갱신
setSelected(saved);
setRightPanel('detail');
```

**수정 시 주의사항:**
`filtered`는 컴포넌트 렌더링마다 새 배열 객체로 재생성됨. 의존성에 `filtered`를 추가하면 매 렌더마다 effect가 실행되어 불필요한 상태 업데이트가 반복될 수 있음. 수정이 필요한 경우 `filtered` 대신 `notices` + `tab`을 의존성으로 사용해야 함.

**재검토 트리거:**
- `handleDelete` / `handleSave` 외 다른 경로에서 `onRefresh`가 호출되는 로직이 추가될 경우

---

#### [HP-04] 하드코딩 텍스트 4곳 — **⬜ 미수정**

| 항목 | 내용 |
|------|------|
| 파일 | `frontend/src/pages/HomePage.tsx` |
| 심각도 | 🟡 i18n 규칙 위반 |

| 위치 | 하드코딩 텍스트 | 필요한 i18n 키 |
|------|----------------|----------------|
| Line 179 | `📣 공지사항` (모달 헤더) | `notice.modal_title` |
| Line 195 | `'전체'` (탭 레이블) | `notice.tab_all` |
| Line 238 | `목록에서 항목을 선택하세요` (빈 상태) | `notice.select_item` |
| Line 376 | `내용을 입력하세요` (입력 placeholder) | `notice.item_placeholder` |

ko.json / en.json 모두에 키 추가 필요.

---

#### [HP-05] `any` 타입 사용 — **⬜ 미수정**

| 항목 | 내용 |
|------|------|
| 파일 | `frontend/src/pages/HomePage.tsx:482` |
| 심각도 | 🟡 타입 규칙 위반 |

```typescript
// 현재
const all: RequestDocument[] = Array.isArray(data)
  ? data
  : (data as any).results ?? [];

// 개선안: ApiListResponse<RequestDocument> 타입으로 교체
```

---

## 미수정 항목 요약

| ID | 내용 | 파일 | 우선순위 |
|----|------|------|---------|
| HP-04 | 하드코딩 텍스트 4곳 (i18n 키 추가 필요) | `HomePage.tsx` | 중 |
| HP-05 | `any` 타입 사용 | `HomePage.tsx:482` | 하 |
