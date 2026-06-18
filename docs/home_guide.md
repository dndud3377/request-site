# GUIDE — 전체 가이드 (모달 + 인터랙티브 투어)

## 개요
홈 화면 상단의 "전체 가이드" 버튼을 클릭하면, 사이드바의 핵심 메뉴(요청관리, 승인현황, 히스토리, VOC, 권한관리) 5개를 순서대로 스포트라이트로 강조하면서 옆에 설명 카드를 띄우는 온보딩 투어. 모달의 "콘텐츠 캐러셀" 구조와 투어의 "실제 UI 요소 하이라이트" 방식을 결합한 형태.

프로토타입 참고: `modal_tour_combined_guide.html` (정적 HTML/CSS/JS 목업, 위치 계산 및 스포트라이트 로직 포함)

## 트리거
- 상단바 "전체 가이드" 버튼 클릭 (기본)
- (옵션, 추후 결정) 신규 로그인 시 1회 자동 시작 — "다시 보지 않기" 체크 시 이후 미노출

## 컴포넌트 구조 (React / TypeScript)
- `GuideTourProvider` — step 상태(`current`, `touring`) 관리하는 context/provider
- `GuideTourSpotlight` — 배경 dimming + 활성 메뉴 항목 cutout
- `GuideTourCard` — 아이콘/제목/설명 + 진행 dot + 이전·다음·건너뛰기 버튼
- `useGuideTourSteps()` — 아래 데이터 모델 기반 step 배열 반환
- 사이드바 메뉴 컴포넌트에 `data-guide-key` 속성 부여 필요 (위치 계산용 anchor)

## 데이터 모델
```ts
interface GuideStep {
  key: string;            // 'request' | 'approval' | 'history' | 'voc' | 'permission'
  navSelector: string;    // 예: '[data-guide-key="request"]'
  title: string;
  description: string;
  icon?: string;
}
```
사이드바 메뉴 구조가 바뀌어도 `navSelector` 매칭만 유효하면 투어 로직은 그대로 동작해야 함.

## 인터랙션 플로우
1. **idle** — 투어 비활성 상태
2. **touring (step 0~4)** — 버튼 클릭 시 step 0(요청관리)부터 시작
3. **다음/이전** — step 변경 시 스포트라이트·카드 위치 재계산, 1단계에서는 "이전" 비활성화
4. **마지막 step(권한관리)** — "다음" 버튼 텍스트가 "시작하기"로 전환, 클릭 시 종료
5. **건너뛰기** — 어느 단계에서든 즉시 종료
6. **다시 보지 않기 체크 + 종료** — 사용자 설정에 플래그 저장

## 위치 계산 로직
- 활성 사이드바 항목을 `getBoundingClientRect()`로 측정해 스포트라이트(top/height)와 카드(top) 위치 계산
- 카드는 항상 사이드바 우측에 고정 거리로 배치, 화살표(::before, rotate 45deg)로 해당 항목과 연결
- `ResizeObserver` 또는 `window.resize` 이벤트로 재계산 — 사이드바 collapse/expand 시에도 동일하게 처리
- 모바일 등 좁은 화면에서 사이드바가 사라지는 레이아웃이면, 투어를 비활성화하거나 중앙 모달 캐러셀로 폴백하는 분기 필요

## 스타일링 노트
- 스포트라이트 dimming: `box-shadow: 0 0 0 9999px rgba(15,17,26,0.55)` 기법 (별도 마스크 이미지 불필요)
- 부모 컨테이너에 `overflow: hidden` 필요 시 shadow가 의도대로 클리핑되는지 확인
- 위치 이동 시 `transition: top 0.35s ease`로 자연스럽게 슬라이드
- z-index 순서: 기본 콘텐츠 < spotlight < tour card

## 영속성 ("다시 보지 않기")
두 가지 옵션 중 선택:
- **옵션 A (localStorage)**: 구현 간단, 기기 간 동기화 안 됨
- **옵션 B (백엔드 저장, 권장)**: OIDC 인증 기반 시스템이므로 `UserPreference` 모델에 `guide_tour_seen: bool` 필드 추가, 다른 기기/브라우저에서도 일관되게 동작

## 접근성 / 예외 처리
- `Esc` 키로 투어 즉시 종료
- 키보드 탐색(Tab) 시 카드 내 버튼 포커스 순서 보장
- 사이드바 메뉴 항목이 동적으로 숨겨지는 권한별 화면이라면, 해당 step은 스킵하도록 처리 (예: 권한관리 메뉴가 없는 사용자)

## 향후 확장 고려
- 기존 기능별 가이드(TipTap 슬라이드 패널)와 콘텐츠 소스를 공유할 수 있도록, `GuideStep.description`을 TipTap JSON/HTML 콘텐츠로 대체 가능하게 설계 여지를 남길 것

## 수용 기준 (Acceptance Criteria)
- [ ] "전체 가이드" 버튼 클릭 시 1단계(요청관리)부터 투어 시작
- [ ] 각 단계마다 스포트라이트·카드가 올바른 사이드바 항목 위치로 이동
- [ ] 이전/다음 버튼 정상 동작, 1단계에서 "이전" 비활성화
- [ ] 마지막 단계에서 버튼 텍스트가 "시작하기"로 바뀌고 클릭 시 투어 종료
- [ ] "건너뛰기" 클릭 시 어느 단계에서든 즉시 종료
- [ ] "다시 보지 않기" 체크 후 종료 시, 재방문해도 자동 시작되지 않음
- [ ] 윈도우 리사이즈/사이드바 토글 시에도 스포트라이트·카드 위치가 깨지지 않음
