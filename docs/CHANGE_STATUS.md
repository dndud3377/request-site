# CHANGE_STATUS — 변경 현황

`api_photosteps1`/`api_photosteps3~5` 및 그 하위 테이블(`_ov`, `_cd`, 총 12개)이 스케줄러
동기화(10분 주기, `sync_rtdb_options`)로 갱신될 때 **실제로 무엇이 추가/삭제됐는지** `processid`
단위로 묶어 보여주는 화면. 기존 데이터를 직접 조회하는 것이 아니라, 동기화 과정에서 감지된
변경 **이력**을 보여준다 — 이력 없이 조용히 동기화되면 화면에도 아무 것도 뜨지 않는다.

- 화면: `frontend/src/pages/ChangeStatusPage.tsx`
- 경로: `/change-status` (`App.tsx` — `ProtectedRoute`, 결재 현황 `/approval` 바로 옆 메뉴)
- API: `GET /api/photostep-changes/` (`backend/api/views.py` `photostep_changes`)
- 저장 모델: `PhotoStepChangeLog` (`backend/api/models.py`)
- 이력 생성 지점: `backend/api/scheduler.py` `_write_step_if_changed()` / `_record_step_changes()`
  (상세 배경은 `docs/SCHEDULER.md` "스텝 변경 이력 기록" 절 참고 — 이 문서는 **화면·API 관점**만 다룬다)

---

## 1. 데이터가 만들어지는 시점

스케줄러가 10분마다 라인1·3~5의 스텝을 동기화하며, 테이블 전체 키 집합이 이전과 다를 때만
`DELETE 전체 → INSERT`한다(`_write_step_if_changed()`). 이 비교 시점에 이미 계산되는
`added`(새로 생긴 키)/`removed`(없어진 키)를 그대로 `PhotoStepChangeLog`에 기록한다 — 별도로
데이터를 다시 스캔하거나 스냅샷을 비교하는 추가 로직이 없다.

- **12개 테이블 전부 대상**: 라인별 전체 테이블(`api_photosteps{N}`, `table_type=ALL`),
  POVLAY 전용 하위 테이블(`api_photosteps{N}_ov`, `table_type=OV`), XXXXXX(임시값) 전용 하위
  테이블(`api_photosteps{N}_cd`, `table_type=CD`) 각각 독립적으로 diff 를 남긴다. 같은 processid
  변경이 전체 테이블과 POVLAY 하위 테이블 양쪽에 동시에 걸리면(그 행의 eqptype 이 POVLAY 인 경우)
  두 건의 별개 변경으로 각각 표시된다.
- **변경이 없으면 기록도 없다**: 동기화 자체는 10분마다 돌지만, 키 집합이 이전과 동일하면
  `_write_step_if_changed()`가 쓰기 자체를 skip 하므로 이력도 생기지 않는다.
- **processid 로 그룹핑**: 한 번의 diff(같은 테이블·같은 감지 시점)에서 나온 행들은 `sync_run_id`
  (UUID)로 묶이고, 그 안에서 `processid`가 같은 행끼리 하나의 "변경" 단위가 된다.

예: `api_photosteps1`에 A,B,C 가 있다가 다음 주기에 A,B,D,E,F 로 바뀌면(C 는 없어지고 D,E,F 가
새로 생김) — C/D 의 processid 가 X, E/F 의 processid 가 Y 라면 화면에는 "라인1-X 변경"(삭제 C,
추가 D), "라인1-Y 변경"(추가 E, F) 두 건으로 나뉘어 표시된다.

---

## 2. 조회 API — `GET /api/photostep-changes/`

| 쿼리 파라미터 | 값 | 설명 |
|---|---|---|
| `line` | `라인1`/`라인3`/`라인4`/`라인5` | 생략 시 전체 라인 |
| `table_type` | `ALL`/`OV`/`CD` | 생략 시 전체 구분 |
| `page` | 정수(기본 1) | 그룹 단위 페이지 번호 |
| `page_size` | 정수(기본 20, 최대 100) | 페이지당 그룹 수 |

응답:
```json
{
  "count": 2,
  "page": 1,
  "page_size": 20,
  "truncated": false,
  "results": [
    {
      "sync_run_id": "...",
      "line": "라인1",
      "table_type": "ALL",
      "processid": "X",
      "detected_at": "2026-09-10T04:20:00Z",
      "added": [{"stepseq": "D", "descript": "...", "recipeid": "...", "areaname": "...", "eqptype": "...", "layerid": "...", "updated": "..."}],
      "removed": [{"stepseq": "C", ...}]
    }
  ]
}
```

- 권한: `IsAuthenticatedInProd` (운영=로그인 필요, 개발=허용) — 다른 읽기 전용 마스터 API(`/lines/` 등)와 동일.
- **그룹핑은 서버(파이썬)에서** 이뤄진다 — `PhotoStepChangeLog`를 `detected_at` 내림차순으로 최근
  `PHOTOSTEP_CHANGE_LOG_MAX_ROWS`(5,000)건까지 읽어 `(sync_run_id, processid)` 로 묶은 뒤 그 **그룹**
  단위로 페이지네이션한다. 이 상한에 걸리면 `truncated: true`가 내려간다(화면은 안내 문구만 보여줄 뿐,
  더 오래된 이력을 추가로 불러오는 기능은 없다).
- **보관 정책 없음**: `PhotoStepChangeLog`는 자동으로 지워지지 않는다. 필요해지면 별도 정리
  배치를 추가해야 한다(현재 범위 밖).

---

## 3. 화면 (`ChangeStatusPage.tsx`)

- 상단 필터: 라인 선택(전체/라인1/라인3/라인4/라인5), 테이블 구분 선택(전체/전체(ALL)/POVLAY 전용/XXXXXX 전용).
  필터를 바꾸면 1페이지로 리셋 후 다시 조회한다.
- 목록은 그룹 카드 단위 — 제목은 `{라인}-{processid} 변경`(테이블 구분이 ALL 이 아니면
  `{라인}({구분})-{processid} 변경`), 감지 시각(`formatDateTime`), 삭제/추가 항목(각 항목은
  `stepseq (descript)` 형태로 콤마 나열)을 보여준다.
- `loading`/`error`/빈 목록 3가지 상태를 모두 처리한다 — 로딩 중엔 로딩 문구, 조회 실패 시
  재시도 버튼, 변경 이력이 없으면 빈 상태 안내를 보여준다(공통 i18n 키 `common.loading`/
  `common.load_error`/`common.retry` 재사용).
- 페이지네이션: 이전/다음 버튼 + `page / totalPages` 표시(그룹 20개 단위).
- 접근 권한: `/approval`과 동일하게 NONE 을 제외한 모든 역할(PL/TE_R/TE_P/TE_J/TE_O/TE_E/MASTER).

---

## 4. 수동 검증 시나리오

자동 테스트(아래 §5)는 diff 계산과 API 그룹핑을 검증하지만, 실제 스케줄러가 도는 화면 흐름은
개발 DB 의 스텝 테이블 데이터가 실제로 바뀌어야 재현된다. 원격/컨테이너 환경 등 스케줄러를 직접
돌릴 수 없는 경우, 아래처럼 Django shell 로 이력을 직접 만들어 화면을 확인할 수 있다.

1. 개발 서버(`http://localhost:10011`) 접속 → 아무 역할로 로그인 → 상단 메뉴에서 **"결재 현황"
   바로 옆의 "변경 현황"** 클릭.
   - 성공 판정: `/change-status` 로 이동하고 상단에 "변경 현황" 제목, 라인/테이블 구분 필터가 보인다.
2. 이력이 아직 없는 초기 상태라면 **"표시할 변경 이력이 없습니다."** 빈 상태 문구가 보이는지 확인.
3. 백엔드 컨테이너에서 아래처럼 테스트용 이력을 하나 만든 뒤 새로고침:
   ```bash
   docker exec -it <backend_container> python manage.py shell -c "
   import uuid
   from django.utils import timezone
   from api.models import PhotoStepChangeLog as L
   run = uuid.uuid4(); now = timezone.now()
   L.objects.create(sync_run_id=run, line='라인1', table_type='ALL', processid='X', change_type='removed', stepseq='C', descript='', recipeid='', areaname='', eqptype='', layerid='', updated='', detected_at=now)
   L.objects.create(sync_run_id=run, line='라인1', table_type='ALL', processid='X', change_type='added', stepseq='D', descript='', recipeid='', areaname='', eqptype='', layerid='', updated='', detected_at=now)
   "
   ```
   - 성공 판정: 화면에 "라인1-X 변경" 카드가 나타나고, 삭제 C / 추가 D 가 각각 표시된다.
4. 상단 라인 필터를 "라인1" 외의 값으로 바꾸면 방금 만든 카드가 사라지는지(필터가 실제로 서버에
   적용되는지) 확인 → 다시 "전체 라인"으로 돌리면 재노출.
5. (선택, 실제 동기화 확인용) 개발환경에 `run_scheduler`가 떠 있다면, RTDB 쪽 스텝 데이터가 실제로
   바뀌는 시점(최대 10분 주기)에 이 화면이 새 카드를 자동으로 보여주는지 확인한다 — 이 경우는
   외부 데이터 변경에 의존하므로 재현 시점을 특정할 수 없다.

---

## 5. 자동 테스트

`backend/api/tests.py`:
- `WriteStepChangeLogTest` — diff(added/removed)가 `PhotoStepChangeLog`에 processid 별로 올바르게
  기록되는지, line/table_type 없이 호출하면(기존 호출부) 이력이 생기지 않는지, 변경이 없으면
  이력도 생기지 않는지 검증.
- `PhotoStepChangesApiTest` — `GET /api/photostep-changes/`가 `(sync_run_id, processid)` 로
  정확히 그룹핑해 반환하는지, `line` 필터가 동작하는지, 미인증 요청이 SSO 모드에서 거부되는지 검증.
