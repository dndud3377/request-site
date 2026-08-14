# 결재 경우의 수 케이스 러너 (개발환경 전용)

`docs/APPROVAL_CASES_VALIDATION.md` 에 열거한 **124개 케이스를 개발환경에서 실제로 실행**한다.

- **개발용 사이트의 Django REST API 를 직접 호출**해 케이스마다 의뢰서를 **실제로 상신**하고
  결재를 끝까지 진행한다. 화면 조작이나 모의 객체 없이
  `POST /api/documents/` → `submit/` → `peer-approve/` → `assign-step/`·`claim-step/` →
  `approve-step/`·`reject-step/` → `request-pause/`·`withdraw/` 를 그대로 탄다.
  그래서 권한 검사·경로 분기·동시성 가드가 우회 없이 검증된다.
- 상신·결재에 쓰는 계정은 **`@company.com` 개발용 계정**이다(아래 §계정).

## 준비

1. 개발환경이 떠 있어야 한다(`docker-compose.dev.yml`, 화면 `http://localhost:10011`).
2. **`AUTH_MODE=dev`** 여야 한다 — 러너는 `POST /api/auth/dev-login/` 으로 역할별 계정에 로그인한다
   (비밀번호 없이 loginid 만으로 발급되는 개발 전용 로그인).
3. 개발 DB 에 **`@company.com` 개발용 계정**이 있어야 한다. 없으면 아래로 만든다.

   ```bash
   docker exec -it request_backend_dev python manage.py create_users
   ```

   `create_users` 가 만드는 시드 계정(전부 `@company.com`):

   | 역할 | loginid | 메일 |
   |---|---|---|
   | `PL` | `pl_user` ~ `pl_user6` (6명) | `pl.user@company.com` |
   | `TE_R` | `agent_r1~r3` | `agent.r1@company.com` … |
   | `TE_P` | `agent_p1~p3` | `agent.p1@company.com` … |
   | `TE_J` | `agent_j1~j3` | `agent.j1@company.com` … |
   | `TE_O` | `agent_o1~o3` | `agent.o1@company.com` … |
   | `TE_E` | `agent_e1~e3` | `agent.e1@company.com` … |
   | `MASTER` | `master` | `master@company.com` |

   러너는 `GET /api/users/?role=<역할>` 결과에서 **메일이 `@company.com` 인 계정만** 골라 쓴다
   (실사용자 계정 이름으로 의뢰서·결재 이력이 남지 않게 하기 위해서다).
   도메인이 다르면 `--mail-domain '@other.com'`, 필터를 끄려면 `--allow-any-account`.
   의뢰자 정보(`requester_email`·`requester_department`)도 그 계정의 실제 값이 그대로 들어간다.

4. 역할별 권장 인원은 아래와 같다. 부족한 역할이 쓰이는 케이스는 자동으로 `SKIP` 되고
   사유("TE_E 2명 필요(현재 1명)")가 출력된다.

   | 역할 | 권장 인원 | 쓰임 |
   |---|---|---|
   | `PL` | 3명 이상 | 작성자 / 지정 PL / SA·추가 후결자 |
   | `TE_R` | 2명 | R 담당자 + 검토자(RV), 고정 후결자 |
   | `TE_P` | 3명 | P 담당자 + 검토자(PV) 2명 |
   | `TE_J` | 2명 | J 담당자 + 선점 경쟁(C-02) |
   | `TE_O` | 2명 | O 담당자 + 팀 공동 합의(A-04) |
   | `TE_E` | 3명 | E 담당자 + 검토자(EV) 2명 — **E 는 검토자 필수라 최소 2명** |
   | `MASTER` | 1명 | 관리자 권한 케이스 |

5. 메일은 서버 설정을 그대로 따른다. 개발환경에 **`MAIL_REDIRECT_TO`** 가 설정돼 있으면
   모든 메일이 그 주소로만 가므로 안전하다.

## 실행

```bash
# 저장소 루트에서
python3 -m scripts.approval_cases.run_cases --list                 # 케이스 목록만
python3 -m scripts.approval_cases.run_cases                        # 전체 실행
python3 -m scripts.approval_cases.run_cases --group F --group PE   # 그룹만
python3 -m scripts.approval_cases.run_cases --case F-05            # 한 건만
python3 -m scripts.approval_cases.run_cases --report /tmp/result.md
```

옵션: `--base-url`(기본 `http://localhost:10011`), `--mail-domain`(기본 `@company.com`),
`--allow-any-account`, `--stop-on-fail`, `--scan-limit`,
`--bootstrap <loginid>`(마스터 데이터 조회에 인증이 필요한 환경), `--timeout`.

종료 코드: `0` = FAIL·ERROR 없음 / `1` = 실패 있음 / `2` = 환경 준비 실패.

## 상신에 쓰는 값은 전부 실제 DB 값이다

화면(RequestPage)이 쓰는 것과 **같은 form-options API 를 같은 순서로** 호출해 조합을 찾는다.

```
GET /api/lines/                          → 라인
GET /api/form-options/processes/         → 조합법
GET /api/form-options/products/          → 제품
GET /api/form-options/process-id/        → process_id
GET /api/form-options/job-file-layer/    → J-layer 행(pp = recipeid)
GET /api/form-options/ovl-layer/         → O-layer 행
```

- 의뢰서 제목도 화면과 같은 규칙으로 만들어진다:
  `{라인}({목적})_MAP({map_type})_{조합법}_{제품}_{process_id}_요청서_{YYMMDD}`
  — 테스트 표식을 붙이지 않으므로 목록에서 실제 의뢰서와 같은 모습으로 보인다.
- E(MASK) 단계가 필요한 케이스는 `pp`(=`recipeid`)에 `plel` 이 든 행이 있는 조합을 찾아 쓴다.
  개발 DB 에 그런 행이 없으면 해당 케이스는 `SKIP` 되고 그 사유가 출력된다.

## 남는 데이터

**생성한 의뢰서를 지우지 않는다.** 실행 후 `/approval`·`/history` 화면에서 결과를 눈으로
확인할 수 있다(그리드 표시·제목·결재 경로 탭까지가 검증 대상이기 때문이다).
정리는 화면의 철회/삭제 기능으로 한다 — 러너에는 일괄 삭제 기능을 두지 않았다.

## 파일

| 파일 | 역할 |
|---|---|
| `run_cases.py` | CLI 진입점 · 결과 표/보고서 출력 |
| `cases.py` | 케이스 124건 정의(문서의 ID 와 1:1) |
| `flows.py` | 상신·합의·반려·중단·철회 조작 + 검증 헬퍼 |
| `payload.py` | 화면과 같은 모양의 의뢰서 payload 빌더 |
| `masterdata.py` | 실제 DB 마스터 데이터·역할 계정 탐색 |
| `client.py` | dev-login · HTTP 클라이언트(표준 라이브러리만 사용) |

## SKIP 되는 케이스(설계상 HTTP 로 확인 불가)

| 케이스 | 이유 | 대신 확인할 방법 |
|---|---|---|
| R-13, PE-14, F-15, X-03, X-04 | 메일 수신자 산출은 API 로 관측되지 않는다 | `backend/api/tests.py` `RecipientResolutionTest` |
| PE-11, PE-12 | 레거시 데이터 상태(검토자 없는 E approved 등)를 새 문서로 만들 수 없다 | 백엔드 테스트 |
| M-07 | 중단·재개가 같은 날이면 연장분이 0일이라 관측 불가 | 백엔드 테스트 |
| X-08 | 프론트 계산(`utils/approvalTable.ts`) | `approvalTable.test.ts` · 화면 |
