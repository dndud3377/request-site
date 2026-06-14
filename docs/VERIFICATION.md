# VERIFICATION — 검증 체크리스트

> 대상 브랜치: `claude/adoring-cori-an1o34`
> 범위: 1차(상신/결재 안정성) + 2차(7개 항목) 전체 변경의 검증 방법.
> ⚠️ 이 작업 세션엔 Django·브라우저가 없어 백엔드 `check`/`test`와 실제 UI 동작은
> docker 개발환경에서 직접 확인해야 한다. 체크박스를 채우며 검증한다.

---

## 0. 사전 준비

```bash
cd /home/user/request-site
docker compose -f docker-compose.dev.yml up -d
docker ps --format "{{.Names}}"     # <backend>/<frontend> 컨테이너명 확인
```
- 접속: http://localhost:10011
- 역할별 계정 준비(개발용 로그인): PL / TE_R / TE_P / TE_J / TE_O / TE_E / MASTER
  (결재 흐름·동시성 검증에 필요)

---

## 1. 자동 검증 (코드 레벨)

- [ ] 프론트 타입체크 — 출력이 비어야 정상(아래 명령이 신규 에러만 필터)
  ```bash
  cd frontend && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "tsconfig.json"
  ```
  (tsconfig deprecation 2건은 기존 이슈로 무관)
- [ ] 프론트 테스트
  ```bash
  cd frontend && CI=true npx react-scripts test --watchAll=false --passWithNoTests
  ```
- [ ] 백엔드 시스템 체크
  ```bash
  docker exec -it <backend> python manage.py check
  ```
- [ ] 백엔드 테스트
  ```bash
  docker exec -it <backend> python manage.py test api
  ```
- [ ] 마이그레이션 누락 점검
  ```bash
  docker exec -it <backend> python manage.py makemigrations --check --dry-run
  ```

---

## 2. 1차 작업 검증 (상신/결재 안정성)

### 2-1. 상신 실패 방지 — 자동저장↔상신 race
- [ ] 신규 작성 → 임시저장 → 상신: 정상 1건만 생성(결재현황/이력에 **중복 없음**)
- [ ] (코드 확인) `isPersistingRef` 가드가 handleSaveDraft / handleIdleAutoSave / handleSubmit에 적용

### 2-2. 백엔드 트랜잭션 (부분 저장 방지)
- [ ] 정상 경로 동일: 상신→결재현황 노출, 재상신→round+1
- [ ] (선택) submit 내 ApprovalStep.create 뒤 임시 예외 → status가 under_review로 안 넘어가고 draft 유지(롤백) 확인 후 원복

### 2-3. 동시 합의 lost-update 방지 (select_for_update)
- [ ] R 합의 후 J·O를 두 결재자(다른 브라우저)로 거의 동시에 합의 → 문서가 `approved`로 정상 전이(under_review에 멈추지 않음)

### 2-4. 결재/이력 error 상태
- [ ] 백엔드 중단/네트워크 차단 후 결재현황·이력 진입 → ⚠️ "목록을 불러오지 못했습니다." + [다시 시도]
- [ ] [다시 시도] 클릭 시 재조회 동작

### 2-5. 이력 삭제 실패 표시 (MASTER)
- [ ] 삭제 성공 → "문서가 삭제되었습니다." 토스트, 모달 닫힘
- [ ] 삭제 실패(권한/네트워크) → "처리 중 오류가 발생했습니다." 토스트(과거엔 무반응)

### 2-6. 문서
- [ ] `docs/APPROVAL.md` §6 "의도 확인 필요" 항목이 의도와 일치하는지 검토

---

## 3. 2차 작업 검증 (7개 항목)

### 3-1. [항목1·7] 데이터 전달 / 이미지 / 비활성화 / DB
- [ ] 작성 시 M-shot 이미지 붙여넣기 → 상신 → 결재현황·이력 상세보기에서 이미지 표시(`/media/mshot_images/...`)
- [ ] J/O 행 일부 비활성화 후 상신 → 상세보기에 비활성 행 안 보임
- [ ] DB에 비활성 행 미저장 확인
  ```bash
  docker exec -it <backend> python manage.py shell -c \
  "from api.models import RequestDocument as R; import json; d=R.objects.latest('id'); print(json.loads(d.additional_notes).get('jayerRows',[]))"
  ```

### 3-2. [항목2] 중복 통일 (회귀 확인)
- [ ] 결재현황/이력 날짜 표시 기존과 동일(formatDate 통일)
- [ ] J/O 표·상세보기 ST 셀 색상 기존과 동일(ST_CELL_COLOR 단일화)
- [ ] 결재 합의/반려/상신 정상(백엔드 _max_round 통일)

### 3-3. [항목3] dead code (회귀만)
- [ ] 로그아웃 / OIDC 콜백 / 라인 선택 시 공정 옵션 로딩 정상

### 3-4. [항목4] 내용 작성 UI 통일 (RichTextEditor)
- [ ] VOC 작성: 서식 툴바 에디터, 굵게/색/목록/이미지 업로드·붙여넣기 동작 → 상세에서 서식대로 표시
- [ ] 공지(notice) 작성(MASTER): 에디터로 작성 → 상세 표시
- [ ] 기존 평문 공지 열기 → 줄바꿈 유지(깨지지 않음, pre-wrap)
- [ ] release_note는 기존 New/Updated/Bugfix 항목 입력 그대로(변경 없음)

### 3-5. [항목5(1)] No 행번호 열
- [ ] J/O 표 좌측 No(1,2,3…) 표시, 정렬/행추가 시 자연 갱신

### 3-6. [항목5(3)] 체크박스 단일 클릭
- [ ] 행 체크박스 한 번 클릭 → 한 번에 체크/해제(과거: 무반응)
- [ ] 드래그 선택(범위 체크/해제) 여전히 정상

### 3-7. [항목5(2)] 엑셀식 복사-붙여넣기 ⭐
- [ ] 단일 값 일괄: 한 셀 값 복사 → 드래그로 여러 셀 선택 → Ctrl+V → 전부 채워짐
- [ ] Ctrl 다중선택: Ctrl+클릭으로 떨어진 셀 선택 → Ctrl+V → 선택 셀만 채워짐
- [ ] 표 형태 spill: 엑셀에서 여러 행×열 복사 → 좌상단 셀 클릭 → Ctrl+V → 구조대로 펼쳐 채워짐
- [ ] 잠긴 셀(비활성/기등록) 건너뜀
- [ ] 선택 셀 파란 외곽선 표시

### 3-8. [항목6] 기등록 잠금 해제
- [ ] new_or_copy를 '기등록'으로 → 행 입력 잠김(회색)
- [ ] 다른 값으로 변경 → 해당 행 입력 잠금 해제(과거: 못 바꿈)

---

## 3-9. [3차] J/O 표 추가 개선 6건

- [ ] (1) 셀 선택 시 **연한 파란 배경**(엑셀식)으로 표시 — 기존 셀 색 위에 자연스럽게 얹힘
- [ ] (2) 셀 선택/드래그 후 **표 밖(다른 영역) 클릭 → 선택 해제**
- [ ] (3) 셀 선택 후 **Delete 키 → 선택 셀 값 모두 비움**(잠긴/기등록 셀은 안 지워짐)
- [ ] (4) Step2/Step3 모두: **product_name 입력 시 step이 비어있으면 layer 값으로 자동**;
      layer가 비어있으면 자동채움 안 함; 자동채움 후 수동 수정 가능(빈 칸일 때만 채움)
- [ ] (5) Step3(O-layer)에 **col_layer 열**이 sd↔pp 사이에 표시(작성 표 + 상세보기 모두)
- [ ] (6) O-layer 자동조회 시 **layer 열도 자동으로 채워짐**(Step2 JOB FILE 방식과 동일)

## 3-10. [4차] item_id 바코드 매칭을 n7c_layer_num 기반으로 재설계

- [ ] 백엔드: `/form-options/barcode/` 응답 label이 `n7barcode [날짜]` 형식, 키가 `spec`(= n7c_layer_num의 '_' 앞 첫 세그먼트)
- [ ] 동기화 쿼리: n7material_spec NULL 조건 없음, n7mto_date 없는 행은 API에서 제외
- [ ] J-layer item_id 드롭다운 후보가 **step 숫자가 spec(= layer_num 첫 세그먼트)에 숫자경계로 일치**하는 것만 노출
      (예: step=1.0 → 11.0ABC/10.0DEF 제외, 1.0GH 만)
- [ ] 매칭 후보가 **정확히 1개면 item_id 자동채움**, **2개 이상이면 빈칸 + 드롭다운에서 선택**
- [ ] product_name / step 변경 시마다 자동매칭 재실행
- [ ] **붙여넣기로** product_name/step을 채워도 step=layer 자동·바코드 조회·자동매칭이 동작
      (O-layer 붙여넣기는 step=layer 자동까지)

## 4. 변경 핵심 파일
- 프론트: `RequestPage/{index,constants}.tsx`, `components/{Step2,Step3}.tsx`,
  `hooks/useCellSelection.ts`, `utils/{date,stCellColor}.ts`,
  `pages/{ApprovalPage,HistoryPage,HomePage,VOCPage,OIDCCallbackPage}.tsx`, `components/Navbar.tsx`
- 백엔드: `api/views.py`
- 문서: `docs/{APPROVAL,FIX_PROGRESS,VERIFICATION}.md`

---

*검증 중 문제가 발견되면 `docs/FIX_PROGRESS.md`에 기록하고 대응한다.*
