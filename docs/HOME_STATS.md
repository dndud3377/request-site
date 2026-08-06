# HOME_STATS.md — 홈 화면 연간 제품별(디자인룰) 의뢰 현황 그래프

홈 화면 Hero 아래에 표시되는 연간 통계 그래프의 데이터 규칙과 API 스펙.

관련 파일
- 집계 로직: `backend/api/design_rule_stats.py`
- API: `backend/api/views.py` (`RequestDocumentViewSet.annual_design_rule_stats`,
  `ProcessDesignRuleOverrideViewSet`, `DocumentDesignRuleOverrideViewSet`)
- 모델: `backend/api/models.py` (`DesignRule`, `ProcessDesignRuleOverride`, `DocumentDesignRuleOverride`)
- 화면: `frontend/src/components/AnnualDesignRuleChart.tsx`,
  `frontend/src/components/DesignRuleClassifyModal.tsx`
- 마운트: `frontend/src/pages/HomePage.tsx`
- i18n: `home.chart.*` (ko.json / en.json)

---

## 1. 무엇을 세는가

| 항목 | 값 |
|------|-----|
| 대상 상태 | `status='approved'` (결재 완료)만 |
| 연도 기준 | `submitted_at` (최초 상신일)의 **Asia/Seoul 로컬 연도** |
| X축 | 디자인룰 (`DesignRule.design_rule`) — 화면에는 **"N나노"** 로 표시(§2 참조) |
| Y축 | 의뢰서 건수 |
| 드릴다운 | 요청 목적(`detail.request_purpose`)별 건수 |

`submitted_at` 은 `views.py` 의 submit 처리에서 `document.submitted_at or timezone.now()` 로
**최초 상신 시각이 확정 저장**되므로, 반려 후 재상신해도 연도가 흔들리지 않는다.
`submitted_at` 이 비어 있는 문서는 연도를 정할 수 없으므로 집계에서 제외한다.

---

## 2. 디자인룰 판정 우선순위

의뢰서의 조합법은 `additional_notes` JSON 의 `detail.process_selection` 에 있다.
이 값을 디자인룰로 바꿀 때 아래 순서로 판정한다.

1. **의뢰서 단위 수동 매핑** — `DocumentDesignRuleOverride` (MASTER 지정)
2. **조합법 단위 수동 매핑** — `ProcessDesignRuleOverride` (MASTER 지정)
3. **`DesignRule` 마스터의 단일 매칭** — 한 조합법이 디자인룰 **하나**에만 걸릴 때
4. 그 외 전부 → **미분류**

①②③ 으로 값이 정해졌더라도, 그 값이 **숫자로 해석되지 않아 나노 표시를 만들 수
없으면** 역시 미분류로 보낸다(`design_rule_stats._to_nano_label`). X축 막대명이
항상 "N나노" 형태이길 보장하기 위한 규칙이며, 분류 모달의 "조합법"/"의뢰서" 탭에
`non_numeric` 사유로 나타나 MASTER 가 다시 고를 수 있다.

### 나노 표시 규칙

디자인룰 마스터 값은 마이크론(µm) 단위 문자열이다. 화면에는 `값 × 1000` 을
불필요한 0 을 제거한 "N나노" 형태로 표시한다 (`0.13` → `130나노`, `0.001` → `1나노`).
**서버 저장·매칭에 쓰이는 실제 값(`key`, 수동 매핑 API 페이로드)은 항상 원본
문자열 그대로**이고, `label`/`design_rule_label` 만 표시용으로 변환된다.

### 왜 "단일 매칭"만 인정하는가

스케줄러 쿼리가 `SELECT DISTINCT n7process, n7design_rule` 이라, 한 조합법이 서로 다른
디자인룰 여러 개와 짝지어질 수 있다. 이때 임의로 하나를 고르면 분류 근거가 사라지므로
**미분류로 보내 MASTER 가 직접 고르게** 한다.

### 수동 매핑이 스케줄러에 지워지지 않는 이유

`sync_design_rule` 은 매일 02:00 에 `api_designrule` 을 `DELETE` 후 재적재한다.
수동 매핑을 같은 테이블에 두면 매일 사라지므로 **별도 테이블 2개**로 분리했다.

---

## 3. 막대 구성 규칙

- **상위 N** — 기준 연도 건수 내림차순. 동률은 이름순(연도를 바꿔도 순서가 안정적).
- **`기타`** — 상위 N 밖 디자인룰을 하나로 합산. `top=all` 이면 생기지 않는다.
- **`미분류`** — 기타와 **합치지 않고** 항상 별도 막대. **0건이어도 유지**한다
  (정리할 게 없다는 사실 자체가 정보이므로).
- 상위 N 선정에서 미분류는 경쟁 대상이 아니다.

## 4. 요청 목적

`신규 / 차용 / 신규+차용 / Only MAP / 기타` 5종 고정.
`frontend/src/pages/RequestPage/constants.ts` 의 `OPTION_REQUEST_PURPOSE` 와 동일하며,
백엔드 `design_rule_stats.REQUEST_PURPOSES` 에 같은 순서로 박혀 있다.

> ⚠️ 프론트 목록을 바꾸면 백엔드 상수도 **반드시 함께** 갱신해야 한다.

정해진 5종 밖 값이거나 비어 있으면 `기타`로 집계한다.

## 5. 증감률

```
delta_pct = (기준연도 건수 − 비교연도 건수) / 비교연도 건수 × 100   (소수 1자리)
```

`delta_state` 로 표현 방식을 구분한다.

| state | 조건 | 화면 표기 |
|-------|------|-----------|
| `up` | 증가 | ▲X.X% · `#1baf7a` |
| `down` | 감소 | ▼X.X% · `#e34948` |
| `flat` | 변화 없음(±0.05% 미만) | 0.0% · 회색 |
| `new` | **비교 연도 0건** + 기준 연도 발생 | `신규` 배지 |

`new` 는 0 으로 나누는 것을 피하기 위한 별도 상태다 — `delta_pct` 는 `null` 로 내려간다.

---

## 6. API

### 6-1. 통계 조회

```
GET /api/documents/annual-design-rule-stats/
```

인증: 로그인 필요(개발 모드 `AUTH_MODE=dev` 에서는 무인증 허용).

| 파라미터 | 기본값 | 설명 |
|----------|--------|------|
| `year` | 승인 건이 있는 가장 최근 연도 | 기준 연도 |
| `compare` | 없음 | 비교 연도. `year` 와 같으면 무시된다 |
| `top` | `10` | `1`~`30` 또는 `all`. 범위 밖은 클램프 |

숫자가 아니거나 `1900~2999` 밖 연도는 조용히 기본값으로 떨어진다
(경계 datetime 생성 시 `OverflowError` 방지).

응답:

```jsonc
{
  "data": {
    "year": 2026,
    "compare_year": 2025,          // 비교 안 하면 null
    "top": 10,                     // all 이면 null
    "available_years": [2024, 2025, 2026],
    "purposes": ["신규", "차용", "신규+차용", "Only MAP", "기타"],
    "buckets": [
      {
        "key": "0.13",             // 서버 저장·매칭용 원본 값
        "label": "130나노",        // 표시용. etc/unclassified 는 "" — 프론트가 i18n 라벨을 붙인다
        "kind": "rule",            // rule | etc | unclassified
        "member_count": 1,         // etc 가 묶은 디자인룰 수
        "count": 42,
        "compare_count": 31,       // 비교 안 하면 null
        "delta_pct": 35.5,
        "delta_state": "up",
        "purposes": { "신규": 15, "차용": 12, "신규+차용": 5, "Only MAP": 6, "기타": 4 },
        "compare_purposes": { }    // 비교 안 하면 null
      }
    ],
    "total": 226,
    "compare_total": 212
  }
}
```

승인 의뢰서가 하나도 없으면 `year: null`, `buckets: []` 로 내려가고 화면은 빈 상태 안내를 띄운다.

### 6-2. 미분류 대상 조회

```
GET /api/design-rule-processes/unclassified/?year=2026
```

`year` 생략 시 전체 승인 건이 대상. 응답 `data`:

- `processes[]` — `{ process, count, reason, candidates[] }`
  - `reason`: `missing`(마스터에 없음) / `ambiguous`(디자인룰 2개 이상에 중복) /
    `non_numeric`(매칭은 됐지만 값이 숫자가 아니라 나노 표시 불가)
  - `candidates`: `ambiguous` 일 때 마스터에 실제로 걸린 후보들. 그 외엔 빈 배열
- `documents[]` — `{ id, title, process_selection, submitted_at, reason, candidates[] }`
  - `reason` 에 `empty`(조합법 미입력)가 추가된다. 조합법이 빈 건은 조합법 매핑으로
    해결할 수 없어 **문서 목록에만** 나타나며, 목록 앞쪽에 정렬된다.
  - `candidates` 는 `processes[]` 와 동일한 규칙(해당 조합법이 `ambiguous` 일 때만 채워짐)
- `design_rules[]` — select 후보. `{ value, label }` 객체 배열이며 나노값 오름차순
  정렬. **숫자로 변환되지 않는 마스터 값은 후보에서 제외**한다(골라도 다시
  미분류로 돌아갈 뿐이라 혼란만 주므로)

### 6-3. 수동 매핑 등록·조회·해제

```
POST   /api/design-rule-processes/       { "process": "RCP-1001", "design_rule": "0.13" }
POST   /api/design-rule-documents/       { "document": 123,        "design_rule": "0.13" }
GET    /api/design-rule-processes/       — 조합법 단위 매핑 전체 목록 (재분류 탭 데이터)
GET    /api/design-rule-documents/       — 의뢰서 단위 매핑 전체 목록 (재분류 탭 데이터)
DELETE /api/design-rule-processes/{id}/  — 매핑 해제("분류 해제")
DELETE /api/design-rule-documents/{id}/  — 매핑 해제("분류 해제")
```

**쓰기(POST/DELETE)는 MASTER 만** (`IsMasterOrReadOnly`). 그 외 역할은 403. 조회(GET)는
로그인만 있으면 된다.

이미 지정된 조합법·의뢰서에 다시 POST 하면 **400 이 아니라 교체(upsert)** 된다.
분류 모달에서 '다시 지정'이 자연스러운 조작이기 때문에, 기본 `UniqueValidator` 를 끄고
`update_or_create` 로 처리한다.

`DELETE` 로 매핑을 지우면 판정 우선순위(§2)상 **한 단계 아래로** 떨어진다 — 조합법
매핑을 지우면 마스터에 값이 남아 있는 한 그 값으로, 없으면 미분류로 간다. 의뢰서
매핑을 지우면 조합법 매핑(또는 마스터, 또는 미분류)으로 떨어진다. **"미분류로
되돌아간다"고 항상 보장되진 않는다** — 분류 모달의 "분류 해제" 확인 문구도 이를
명시한다. GET 목록·`design_rule_label` 필드는 `ProcessDesignRuleOverrideSerializer` /
`DocumentDesignRuleOverrideSerializer` 에서 내려주며, `design_rule_label` 이 나노
변환에 실패하면 원본 값을 그대로 보여준다.

---

## 7. 화면 동작

| 조작 | 결과 |
|------|------|
| 상단 년도 칩 | 기준 연도 변경. 열려 있던 드릴다운은 닫힌다 |
| `⇄ 비교하기` | 비교 모드 토글. 기본 비교 대상은 기준 연도 바로 이전 연도 |
| `표시` 드롭다운 | 상위 10 / 20 / 30 / 전체 |
| `표 보기` | 색에 의존하지 않는 표 형태 병행 표시 |
| 막대 클릭 | 요청 목적별 KPI 드릴다운 열림. **같은 막대 재클릭 시 닫힘** |
| 미분류 막대 → `분류하기` | MASTER 에게만 보이는 분류 모달 |

### 분류 모달 — 조합법 / 의뢰서 / 재분류

3개 탭으로 구성된다.

- **조합법** — 미분류(또는 `non_numeric`) 조합법을 조합법 단위로 일괄 지정
- **의뢰서** — 조합법 단위로 정리 안 되는 예외 건을 의뢰서 하나씩 지정. `missing` /
  `ambiguous` / `non_numeric` 사유가 있는 건은 그 사유가 함께 표시된다
- **재분류** — **이미 분류된** 매핑을 다시 확인·수정. 연도 필터 없이 전체를 보여주며,
  숫자로 정상 표시되는(나노 변환 성공) 매핑만 노출한다 — 비숫자 매핑은 "조합법"/"의뢰서"
  탭에서 `non_numeric` 사유로 이미 다루므로 여기서는 중복 노출하지 않는다. 드롭다운
  맨 아래 "↩ 분류 해제" 를 고르면 그 매핑을 지운다(§6-3의 DELETE)

**드롭다운에서 값을 고르는 즉시 저장된다** — 권한 관리 화면(`PermissionPage`)의 역할
변경과 같은 방식으로, 별도 저장/취소 버튼이 없다. 처리 중인 행의 select 만 잠기고,
성공하면 그 행이 목록에서 사라지며(또는 재분류 탭이면 값이 갱신되며) 부모 차트도
함께 새로고침된다. 모달은 사용자가 "닫기"를 눌러야만 닫힌다.

### 역할별 노출

| 역할 | 그래프 | 분류하기 버튼 |
|------|--------|---------------|
| `NONE` | ✗ (영역 자체를 렌더하지 않음) | ✗ |
| `PL` / `TE_*` | ✓ | ✗ |
| `MASTER` | ✓ | ✓ |

### 접근성

증감 표기의 초록(`#1baf7a`)·빨강(`#e34948`)은 적록색약에서 색만으로는 구분이 어렵다
(검증 기준 ΔE 6.9). 그래서 **▲/▼ 글리프를 항상 숫자와 함께** 렌더해 보조 인코딩으로
삼고, `표 보기`로 색 없이도 같은 값을 읽을 수 있게 한다. 미분류 막대는 색이 아닌
**대각 해칭**으로도 구분된다.

시리즈 색은 기준 연도 `#2563eb`(앱 accent), 비교 연도 `#eb6834` 이며 흰 배경 기준
전체쌍 CVD ΔE 29.9 로 검증됐다.

---

## 8. 주의사항

- **마이그레이션 필수** — 배포 시 `python manage.py migrate` (`0013_design_rule_overrides`,
  2026-08-06 재정렬 전 번호는 `0012`. 상세는 `docs/REQUEST.md` §4.1 2026-08-06 이력 참조).
  누락하면 그래프 API 가 500 을 낸다.
- **개발 환경에서 전부 미분류로 보이면** 버그가 아니라 데이터 부재다.
  `api_designrule` 은 스케줄러(`sync_design_rule`, 매일 02:00)로만 채워지므로
  `SKIP_SCHEDULER=true` 환경에서는 테이블이 비어 있다.
- **조회 성능** — `additional_notes` 가 JSON **문자열** 컬럼이라 DB 에서
  `process_selection` 으로 GROUP BY 할 수 없다. 대상 연도의 승인 문서를 읽어
  Python 에서 파싱하므로, 연도 범위 필터로 대상을 좁히고 `id`/`additional_notes` 만
  가져온다. 승인 건수가 크게 늘어 체감이 생기면 결과 캐시를 검토한다.
- **연도 목록 조회** — MySQL 에서 타임존 변환 date 조회(`CONVERT_TZ`)는 타임존 테이블이
  적재돼 있어야 동작한다. 이에 의존하지 않도록 min/max 를 구한 뒤 연도별 범위 조회로
  존재 여부를 확인한다.
