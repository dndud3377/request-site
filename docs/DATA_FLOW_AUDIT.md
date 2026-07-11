# DATA_FLOW_AUDIT — 의뢰서 작성→결재→이력 저장 경로 데이터 감사

> 작성일: 2026-07-10
> 목적: **의뢰서 작성 → 결재 → 이력 현황** 까지 값이 저장되는 전 경로에서
> (1) 데이터 흐름상 문제/잠재 문제, (2) 목적·값 변경/수정 시 **초기화되지 않고 잔존**해
> 백엔드에 잘못 저장될 수 있는 risk, (3) DB에 실제로 잘 저장되는지 **직접 확인하는 방법**을
> 한 곳에 정리한다.
>
> ⚠️ 이 문서는 **감사(진단) 결과**이며, "확인 방법"대로 재현·검증할 수 있다.

---

## 진행 상태 (2026-07 결정 반영)

| 항목 | 결정 | 상태 |
|------|------|------|
| R-1 요청 목적 변경 시 하위 미초기화 | **그대로 둠**(상관 없음) | 수정 안 함 |
| R-2 C가문 Yes→No prodc/지도편차 잔존 | **초기화 필요** | ✅ 수정됨 |
| R-3 map_change '없음' 시 X/Y/사유 잔존 | **초기화** | ✅ 수정됨 |
| R-4 ea_change '없음' 시 ea_value 잔존 | **초기화** | ✅ 수정됨 |
| R-5 mshot '없음/삭제' 시 이미지 잔존 | **초기화** (+ 다중 붙여넣기는 이미 마지막 1개만 저장) | ✅ 수정됨 |
| R-6 메인 라인 변경 시 prodc 잔존 | **초기화 필요** | ✅ 수정됨 |
| R-7 map_type 변경 시 Step1/뼈찜/J·O 보존 | **의도된 동작** | 유지 |
| R-8 임시저장은 비활성 행도 저장 | **의도된 동작** | 유지 |
| 4-1 제목 300자 초과 시 상신 실패 | **수정 (A안, 600자)** | ✅ 수정됨 |

**R-2~R-5 구현 요약** (`RequestPage/index.tsx` 핸들러 + `StepMap.tsx` select 연결):
- `handleOnlyProdcChange`: C가문 `No` 전환 시 REV·prodc 상/중/하판·지도편차(top/bottom)·prodc 옵션·`prodcCopyRegion` 전부 초기화.
- `handleMapChangeChange`: `변경 없음` 전환 시 `map_value_x/y`,`map_reason` 초기화.
- `handleEaChangeChange`: `변경 없음` 전환 시 `ea_value` 초기화.
- `handleMshotChangeChange`: `추가/수정` 이외(없음·삭제)로 전환 시 `mshot_image_copy/top/bottom` 초기화.
  - 참고: 다중 붙여넣기는 `handleImagePaste`(`index.tsx:1176`)가 필드를 **교체**하므로 **원래부터 마지막 1개만** 문서에 저장된다. (서버에 남는 이전 업로드 파일 정리는 별도 과제)

### 4-1. 제목 300자 초과 — 수정 계획 (승인 후 진행)

- 문제: 자동 제목 `${line}(${purpose})_MAP(${type})_${process}_${partid}_${process_id}_요청서_YYMMDD`
  + 중복 시 `_N` suffix 가 모델 `title CharField(max_length=300)` 를 넘으면 상신/저장이 **HTTP 400** 또는 DB 오류로 실패.
- ✅ **적용된 수정 (A안, 600자)**:
  - `models.py` `title = CharField(max_length=600)` 로 확장(기존 300).
  - 마이그레이션 `0007_alter_requestdocument_title`.
  - `_unique_title`(`views.py:923`)에서 `base_title` 및 `base + '_N'` suffix 가 컬럼 한도(600)를
    **절대 넘지 않도록 방어적으로 truncate**(`title_max = RequestDocument._meta.get_field('title').max_length` 참조).
  - 배포 시 **`python manage.py migrate` 필요.**
- 검증(수정 후):
  - `docker exec -it $BACKEND python manage.py migrate` → `0007` 적용.
  - 아주 긴 조합법/제품명 조합으로 상신 → **400 없이 저장**되는지, §2-3 SQL 의 `title_len` 이 600 이하인지 확인.

---

## 0. 먼저 — 확인 환경 구동 방법 (공통)

모든 검증은 개발 스택(HTTP 10011)에서 한다.

```bash
# 1) 개발 스택 기동
cd request-site
docker compose -f docker-compose.dev.yml up -d

# 2) 컨테이너 이름 확인 (아래 예시의 <backend>/<db> 자리에 넣는다)
docker compose -f docker-compose.dev.yml ps
BACKEND=$(docker compose -f docker-compose.dev.yml ps -q backend)
DB=$(docker compose -f docker-compose.dev.yml ps -q db)

# 3) 프론트: 브라우저에서 http://localhost:10011 → /request

# 4) 백엔드 Django shell (DB 내용 직접 조회)
docker exec -it $BACKEND python manage.py shell

# 5) MySQL 직접 접속 (계정/DB명은 .env 참고 — 읽기만)
docker exec -it $DB mysql -u root -p
```

> `.env` 는 **읽기만** 한다(규칙 D). DB 계정/이름은 `docker-compose.dev.yml` / `.env` 의
> `MYSQL_*` 값을 참고.

---

## 1. 데이터 흐름 지도 (어디서 어떻게 저장되나)

```
[RequestPage 위저드 5단계]  frontend/src/pages/RequestPage/index.tsx
   상태: form(제목/의뢰자/생산일) + detail(DetailFormState) + jayerRows/oayerRows/bbRows
          + rev/tbvtlv/notifiers ...
        │
        │  handleSaveDraft(임시저장) / handleSubmit(상신) / resume(재개)
        ▼
buildEnrichedForm()  index.tsx:2538
   ├─ title 생성: `${line}(${purpose})_MAP(${map_type})_${process}_${partid}_${process_id}_요청서_YYMMDD`  (:2544)
   ├─ product_name = detail.partid_selection                                            (:2570)
   ├─ requester_* = (편집/지정PL면 원본, 신규면 현재 사용자)                              (:2562)
   └─ additional_notes = JSON.stringify({ detail(★전체), jayerRows, oayerRows, bbRows,
                                          history, jayer/oayerActiveFilterIds })          (:2576)
        │
        ▼
documentsAPI.create / update / submit / resubmit / resume   frontend/src/api/client.ts
        │  POST/PATCH /api/documents/...
        ▼
[Backend]  backend/api/
   RequestDocumentViewSet.perform_create   views.py:942  → requester=현재유저, title=_unique_title()
   RequestDocumentViewSet.perform_update   views.py:955  → title=_unique_title(exclude_id)
   RequestDocumentSerializer.update        serializers.py:123 → requester_name/email/department pop(변경 차단)
        │
        ▼
[DB]  RequestDocument (backend/api/models.py:56)
   title(CharField 300) / product_name(CharField 200) / requester_name(100) /
   requester_department(100) / requester_email(EmailField) /
   additional_notes(TextField = MySQL longtext) / status / production_date ...
   결재선: ApprovalStep(모델), 중단: PauseRequest(모델)
        │
        ▼
[이력 현황]  frontend/src/pages/HistoryPage.tsx → PagedDetailView
   documentsAPI.list()/get() 로 조회 → additional_notes 를 JSON.parse → detail/J/O/bb 렌더
```

**핵심(★):** `additional_notes` 에는 `detail` **객체 전체**가 통째로 직렬화된다(`index.tsx:2577`).
즉 화면에서 **조건부로 숨겨졌더라도 state 에 남아 있는 값은 전부 그대로 DB 로 저장**된다.
이 사실이 §3(잔존 데이터 risk)의 근본 원인이다.

---

## 2. [요청 #3] DB에 실제로 저장되는지 직접 확인하는 방법

### 2-1. 브라우저 → 저장 → DB 대조 (기본 검증)

1. `http://localhost:10011` → `/request` 진입.
2. STEP1~5를 **의미 있는 값**으로 채운다. 특히 뒤 검증을 위해 **구분되는 값**을 넣는다
   (예: 고객/업체명 `AUDIT_CUST_001`, 요구사항 `AUDIT_REQ_001`).
3. 하단 **임시저장**(또는 상신) 클릭 → 성공 토스트 확인.
4. Django shell 로 방금 저장분을 확인:

```python
# docker exec -it $BACKEND python manage.py shell
import json
from api.models import RequestDocument
d = RequestDocument.objects.latest('created_at')
print("id:", d.id, "| status:", d.status, "| title:", d.title)
print("product_name:", d.product_name)
print("requester:", d.requester_name, d.requester_email, d.requester_department)
detail = json.loads(d.additional_notes or '{}')
print("detail keys:", sorted(detail.get('detail', {}).keys()))
print("customer_name:", detail['detail'].get('customer_name'))
print("customer_requirement:", detail['detail'].get('customer_requirement'))
print("jayerRows:", len(detail.get('jayerRows', [])), "| oayerRows:", len(detail.get('oayerRows', [])), "| bbRows:", len(detail.get('bbRows', [])))
```

- ✅ 정상: 입력한 값이 그대로 나오면 저장 OK.
- ❌ 실패 신호: `additional_notes` 가 `''`/`{}`, 특정 필드 누락, 한글 깨짐 등.

### 2-2. `additional_notes` JSON 유효성 일괄 점검 (깨진 문서 탐지)

```python
# docker exec -it $BACKEND python manage.py shell
import json
from api.models import RequestDocument
bad = []
for d in RequestDocument.objects.all():
    try:
        json.loads(d.additional_notes or '{}')
    except Exception as e:
        bad.append((d.id, d.title, str(e)))
print("깨진 JSON 문서 수:", len(bad))
for b in bad[:50]:
    print(b)
```

- ✅ 정상: `0`.
- ❌ `1` 이상이면 그 문서는 상세/이력에서 **조용히 빈값**으로 표시된다(§4-2 참조).

### 2-3. MySQL 에서 직접 확인 (선택)

```sql
-- docker exec -it $DB mysql -u root -p  후
USE <db_name>;
SELECT id, status, LEFT(title,60) AS title, CHAR_LENGTH(title) AS title_len,
       CHAR_LENGTH(additional_notes) AS notes_len
FROM api_requestdocument ORDER BY id DESC LIMIT 10;
```

- `title_len` 이 **300 에 근접/도달**하면 §4-1 위험(제목 길이) 신호.
- `notes_len` 로 문서 크기 감시(현재 컬럼은 longtext 라 용량 자체는 안전).

### 2-4. 결재 전이 후에도 저장이 유지되는지

상신 → 각 단계 합의 → **이력(결재완료)** 까지 간 뒤, 2-1 쿼리를 다시 돌려
`status='approved'` 이면서 `additional_notes` 가 보존되는지 확인한다.
(합의/반려/재개는 `additional_notes` 를 건드리지 않으므로 보존되어야 정상)

---

## 3. [요청 #2] 목적/값 변경·수정 시 "초기화되지 않고 잔존"하는 risk 목록

> 근본 원인: `buildEnrichedForm` 이 `detail` 전체를 저장(§1 ★). 아래 필드들은 화면에서
> **조건부로 숨겨질 뿐 state 에서 지워지지 않아**, 이전에 입력했던 값이 그대로 백엔드에 남는다.
> 심각도: 🔴 높음(잘못된 값이 저장/이력에 노출) / 🟡 중간(표시만 부정확) 기준.

### R-1 🔴 요청 목적 변경 시 하위 데이터 미초기화
- 위치: `handleRequestPurposeSelect` (`index.tsx:1198`)
- 현상: **Only MAP 로/에서 바꿀 때만** 초기화 모달이 뜬다. `신규 ↔ 차용 ↔ 신규+차용 ↔ 기타`
  로 바꾸면 `handleDetailSet('request_purpose', val)`(:1210)만 하고 **다른 값은 모두 유지**된다.
  → `other_purpose`, `flow_chart`, `bb_entries`, J/O/bb 표, 참조요청서 병합 결과가 잔존.
- 왜 위험: 예) `기타 + other_purpose=[Layer 추가/삭제]` 로 참조요청서를 병합해 J/O 를 채운 뒤,
  목적을 `신규` 로 바꿔도 병합 J/O·`other_purpose` 가 남아 그대로 저장된다.
- 확인 방법:
  1. `/request` STEP1에서 목적 `기타` 선택 → 기타목적 `Layer 추가/삭제` 체크 → (참조요청서 병합 등으로 J/O 채움).
  2. 목적을 `신규` 로 변경.
  3. 임시저장 → §2-1 쿼리로 `detail.other_purpose`, `jayerRows` 확인 → 이전 값이 남아있으면 재현된 것.
- 참고: `other_purpose` 자체는 목적 변경 시 초기화되지 않음. (단, `Layer 추가/삭제` 미포함 시 참조요청서만 비우는 effect 는 `index.tsx:444` 에 있음)

### R-2 🔴 C가문(only_prodc) Yes→No 전환 시 prodc/지도편차 값 잔존
- 위치: StepMap `only_prodc` `<select>` onChange (StepMap.tsx, "Only C가문 제품" 블록)
- 현상: `No` 로 바꾸면 `rev_yn`/`rev_entries` 만 초기화하고, **`prodc_top/middle/bottom_line/process/product`,
  `prodc_middle_use`, 지도편차 `map_value_x_top/y_top/x_bottom/y_bottom`, `map_change_top/bottom`** 은
  그대로 남는다. 화면은 non-prodc 분기(`map_change`/`map_value_x/y`)로 바뀌지만 state 엔 prodc 값이 잔존.
- 왜 위험: `only_prodc='No'` 문서인데 `additional_notes` 에 prodc 상판/하판 조합·좌표가 저장됨 → 이력/상세에서
  오해 소지, 후속 로직(`is_only_map`/표시)과 불일치 가능.
- 확인 방법:
  1. STEP2(MAP)에서 C가문 `Yes` → 적용 위치로 상/하판 채우고 지도편차 X/Y 입력.
  2. C가문을 `No` 로 변경 → 임시저장.
  3. §2-1 쿼리에서 `detail.prodc_top_line`, `detail.map_value_x_top` 등이 **비어있지 않으면** 재현.

### R-3 🟡 지도 편차 map_change '변경 있음'→'변경 없음' 시 X/Y/사유 잔존
- 위치: StepMap 지도 편차 `map_change` `<select>` (onChange=handleDetailChange, 리셋 없음)
- 현상: `변경 없음` 으로 되돌려도 `map_value_x/y`, `map_reason` 값이 남아 저장된다(입력칸은 `visibility:hidden` 로 가려질 뿐).
- 왜 위험: "변경 없음"인데 좌표/사유가 저장 → 이력 표시·판단 혼란. (검증은 '있음'일 때만 필수라 통과됨)
- 확인: STEP2에서 `변경 있음` + X/Y/사유 입력 → `변경 없음` 전환 → 임시저장 → `detail.map_value_x` 등 잔존 확인.

### R-4 🟡 예외구역 ea_change '있음'→'없음' 시 ea_value 잔존
- 위치: StepMap 예외 구역 `ea_change` `<select>` (리셋 없음)
- 현상/위험/확인: R-3 과 동일 구조. `변경 없음` 인데 `detail.ea_value` 가 남는다.

### R-5 🟡 X표시(mshot_change) '추가/수정'→'없음' 시 첨부 이미지 경로 잔존
- 위치: StepMap X표시 `mshot_change` `<select>` (리셋 없음)
- 현상: `없음`(또는 `삭제`)으로 바꿔도 `mshot_image_copy` / `mshot_image_copy_top` / `mshot_image_copy_bottom`
  (업로드된 파일 경로)가 detail 에 남아 저장된다.
- 왜 위험: 변경 유형과 첨부가 불일치. 상세에서 이미지가 잘못 노출될 수 있음.
- 확인: `수정` 선택 후 이미지 붙여넣기 → `없음` 전환 → 임시저장 → `detail.mshot_image_copy*` 잔존 확인.

### R-6 ✅ 메인 라인 변경 시 C가문 리전 값 잔존 (수정됨)
- 위치: 라인 변경 effect (`index.tsx` "라인 변경 → 조합법 fetch + 하위 초기화").
- **적용된 수정:** 이 effect 의 `!isLoadingEditRef` 블록에 `prodc_top/middle/bottom_line/process/product`,
  `prodc_middle_use`, 지도편차(top/bottom), `rev_yn/rev_entries` 초기화 + `setProdcCopyRegion(null)` +
  리전 process/product 옵션 비우기를 추가했다. 이제 메인 라인을 바꾸면 옛 라인 기준 C가문/REV 값이 남지 않는다.
- 확인: C가문 Yes 로 상/하판 채운 뒤 STEP1 라인 변경 → `detail.prodc_top_line` 등이 **비워지는지** 확인.

### R-7 🟡 (설계상 의도) map_type 변경은 Step1/3/4/5 보존
- 위치: `handleMapTypeChangeConfirm` (`index.tsx:1263`)
- 현상: map_type(NEW/CLONE/EXISTING) 변경 시 **StepMap 필드만** 초기화하고 라인·뼈찜·J/O·partial_shot·tbvtlv 는 **의도적으로 보존**(주석 R-13).
- 판단 필요: 요청 #2("무조건 초기화")와 상충. **의도된 보존인지 재확인** 필요 — 원하면 전체 초기화로 바꿀 수 있음.

### R-8 🟡 임시저장(draft)은 비활성(disabled) 행도 저장
- 위치: `buildEnrichedForm` (`index.tsx:2578`) — `isDraft` 면 `jayerRows/oayerRows` 를 **필터 없이** 저장(비활성 행 포함), 상신 시엔 `!disabled` 만 저장.
- 왜 위험: 임시저장 후 그대로 상신 경로가 아닌 다른 경로로 이어지면 비활성 행이 남을 수 있음(대개는 상신 시 재필터되어 정상).
- 확인: 행 몇 개 비활성화 → 임시저장 → `detail`/`jayerRows` 에 disabled 행 포함 확인.

> **공통 확인 팁:** 위 모든 항목은 §2-1 의 Django shell 쿼리로 `detail.<필드>` 를 직접 찍어
> "화면엔 안 보이는데 값이 남아있는지"를 확정할 수 있다.

> **권장 수정 방향(참고, 미적용):** 조건부 섹션을 '숨김'이 아니라 **값까지 초기화**로 바꾸거나,
> `buildEnrichedForm` 에서 저장 직전에 **현재 조건에 유효한 필드만 남기는 sanitize 단계**를 추가.
> 후자는 한 곳에서 모든 R-1~R-6 을 방어할 수 있어 가장 안전하다.

---

## 4. [요청 #1] 데이터 흐름 전반의 문제/잠재 문제

### 4-1. 🔴 자동 생성 제목이 300자 초과 시 상신/저장 실패
- 위치: title 생성(`index.tsx:2544`) vs 모델 `title = CharField(max_length=300)`(`models.py:70`).
- 문제: 라인/조합법/제품/조리법 이름이 길면 `..._요청서_YYMMDD` 제목이 300자를 넘을 수 있고,
  중복 시 `_2` suffix(`_unique_title`, `views.py:923`)까지 붙어 더 길어진다. DRF 시리얼라이저가
  max_length 300 을 강제하므로 **HTTP 400**(저장 실패)이 날 수 있다.
- 확인: 아주 긴 조합법/제품명 조합으로 상신 시도 → 400 발생/토스트 확인. 또는 §2-3 SQL 의 `title_len` 관찰.
- 참고: 실패 시 사용자에겐 `오류 발생: HTTP 400` 로만 보여 원인 파악이 어렵다.

### 4-2. 🔴 `additional_notes` 손상 시 조용히 유실(silent)
- 위치: `RequestDocument.get_detail()`(`models.py:104`) — 파싱 실패 시 `{}` 반환(예외 삼킴).
  프론트도 `JSON.parse` 실패 시 빈 폼 처리.
- 문제: 어떤 이유로든 JSON 이 깨지면 **오류 없이 빈 데이터**로 표시되어 유실을 인지하기 어렵다.
- 확인: §2-2 쿼리로 깨진 문서 탐지. (현재 정상 저장 경로에선 발생 안 하나, 수동 DB 수정/마이그레이션 시 위험)

### 4-3. 🟡 bb 매핑 검증이 JSON 파싱 실패 시 '통과' 처리
- 위치: `_validate_bb_mapping`(`views.py:170` 부근) — `except (JSONDecodeError, TypeError): pass` 로 검증을 건너뜀.
- 문제: 손상된 `additional_notes` 를 가진 문서가 상신/재상신 시 **매핑 검증을 우회**한다.
- 확인: (재현 난이도 있음) 손상 문서를 만들어 submit 시도 → bb 미매핑인데도 통과하는지.

### 4-4. 🟡 `additional_notes` 가 JSONField 아닌 TextField
- 위치: `models.py:81`. DB 레벨 JSON 검증/쿼리가 불가하고 앱단 파싱에 의존.
- 영향: 4-2/4-3 의 근본 배경. (마이그레이션 부담으로 즉시 변경은 범위 밖)

### 4-5. 🟡 레거시 `requester` FK null 문서
- 위치: `perform_create` 가 `requester=현재유저` 설정(`views.py:942`)은 되어 있으나, 이전(과거) 문서는
  `requester_id=null` 일 수 있어 철회/승인메일/그룹 판정에서 이메일 보조판별에 의존.
- 확인:
```python
from api.models import RequestDocument
print("requester null 문서:", RequestDocument.objects.filter(requester__isnull=True).count())
```
- ❌ 0보다 크면 해당 문서들은 권한/알림 판정이 이메일 기반으로만 동작.

### 4-6. 🟡 수정(update) 시 의뢰자 표시정보는 고정(정상 동작 확인 포인트)
- 위치: `RequestDocumentSerializer.update`(`serializers.py:123`) 가 `requester_name/email/department` 를 pop.
- 의미: 검토자(지정 PL)가 "수정 후 재상신" 해도 의뢰자 표시가 안 바뀐다(**의도된 동작**). 회귀 확인용.
- 확인: 반려 문서를 다른 PL 계정으로 수정·재상신 → 의뢰자 이름이 원작성자로 유지되는지.

### 4-7. 🟡 `product_name` 길이 제한
- 위치: `product_name = detail.partid_selection`(`index.tsx:2570`) vs `CharField(max_length=200)`.
- 문제: 제품명이 200자 초과면 400. (일반적으론 짧아 위험 낮음)

---

## 5. 종합 확인 체크리스트 (사용자용)

DB 저장(#3):
- [ ] §2-1: 브라우저 입력값이 `additional_notes.detail` 에 그대로 저장됨
- [ ] §2-2: 깨진 JSON 문서 수 = 0
- [ ] §2-4: 결재완료(approved) 후에도 `additional_notes` 보존

잔존 데이터 risk(#2) — 각 항목 재현 후 `detail.<필드>` 잔존 여부:
- [ ] R-1 목적 변경(신규↔차용↔기타) 후 `other_purpose`/`jayerRows` 잔존?
- [ ] R-2 C가문 Yes→No 후 `prodc_*`/`map_value_x_top` 잔존?
- [ ] R-3 map_change 없음 후 `map_value_x/y`,`map_reason` 잔존?
- [ ] R-4 ea_change 없음 후 `ea_value` 잔존?
- [ ] R-5 mshot 없음 후 `mshot_image_copy*` 잔존?
- [ ] R-6 메인 라인 변경 후 `prodc_*` 잔존?
- [ ] R-7 map_type 변경 시 Step1/뼈찜/J/O 보존이 의도와 맞는지 판단

흐름 전반(#1):
- [ ] 4-1 긴 제목 상신 시 400 발생 여부
- [ ] 4-5 requester null 문서 수 확인

---

## 6. 우선순위 제안 (수정은 별도 승인 후)

| 우선 | 항목 | 이유 |
|------|------|------|
| 1 | R-1, R-2 | 잘못된 하위 데이터가 실제 저장·이력 노출(🔴) |
| 2 | 4-1 제목 길이 | 상신 자체가 실패(🔴), 사용자 원인 파악 난해 |
| 3 | R-3/R-4/R-5 | 조건부 필드 잔존(🟡) — `buildEnrichedForm` sanitize 로 일괄 방어 가능 |
| 4 | 4-2/4-3/4-4 | JSON 견고성(🟡) — TextField→JSONField 및 파싱 실패 시 명시적 에러 |

> 각 항목의 실제 수정은 이 문서로 재현·합의 후 진행한다. "R-1~R-6 을 한 번에 막는" 가장
> 안전한 방법은 §3 하단의 **저장 직전 sanitize** 접근이다.
