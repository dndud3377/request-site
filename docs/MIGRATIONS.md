# MIGRATIONS — 마이그레이션 관리 가이드

`backend/api` 앱의 마이그레이션 정리 방법을 정리한 문서다.

- 대상 앱: `api`
- DB: MySQL 8.0 (운영 중)
- 마이그레이션 디렉토리: `backend/api/migrations/`

---

## 0. 핵심 개념

- Django 는 `django_migrations` 테이블로 각 마이그레이션의 **적용 이력**을 추적한다.
- 실제 **테이블 스키마**와 **적용 이력**은 별개다. 정리 작업의 핵심은
  **"테이블은 그대로 두고 이력만 새로 맞춘다"** 이다.
- 운영 DB 가 이미 존재하므로, 새 마이그레이션을 실제로 실행하면
  `table already exists` 에러가 난다. → 기존 DB 에는 `--fake` 로 "적용됨" 처리만 한다.
- **마이그레이션 파일을 0개로 비우는 것은 불가능에 가깝다.** 최소 `0001_initial`
  1개는 있어야 신규 배포 / 테스트 DB 생성 / `makemigrations` 가 정상 동작한다.

---

## 1. 정리 방식 비교

| 구분 | squash (replaces 방식) | 완전 리셋 |
|------|------------------------|-----------|
| 최종 파일 수 | 1개 (정리 후) | `0001_initial` 1개 |
| 환경별 수동 작업 | 거의 없음 (`replaces` 가 자동 처리) | 모든 기존 DB 에서 `--fake` 수동 실행 필요 |
| 운영 무중단 | ✅ | ✅ (절차 준수 시) |
| 실수 시 위험 | 낮음 | 환경 누락 시 해당 DB 깨짐 |
| 권장도 | 높음 (안전) | 환경 통제가 확실할 때 |

> 환경 누락 위험이 걱정되면 squash 방식을 권장한다.

---

## 2. squash 방식 (replaces)

`0001~NNNN` 을 단일 압축 마이그레이션으로 합치고 `replaces` 에 원본을 명시한다.
기존 DB 는 압축본을 "적용됨" 으로 간주하므로 무중단이다.

```bash
docker exec -it <backend_container> python manage.py squashmigrations api 0001 <마지막번호>
```

- 생성된 압축 파일에 `replaces = [('api', '0001_...'), ...]` 가 자동으로 들어간다.
- 데이터 마이그레이션(`RunPython`/`RunSQL`)이 있으면 자동 압축되지 않으니 검토 후
  신규 DB 에서 no-op 임이 확실하면 수동 제거할 수 있다.
- **모든 환경이 압축본을 적용 완료한 뒤에만** 원본 파일과 `replaces` 목록을 제거한다.

검증:
```bash
docker exec -it <backend_container> python manage.py makemigrations --check --dry-run   # "No changes" 정상
docker exec -it <backend_container> python manage.py showmigrations api
docker exec -it <backend_container> python manage.py test
```

---

## 3. 완전 리셋 절차

모든 마이그레이션을 삭제하고 `0001_initial` 단일 파일로 재생성한다.

### 0단계: 사전 준비 (필수)
```bash
# 운영/개발 모든 DB 백업
docker exec <mysql_container> mysqldump -u <user> -p <db_name> > backup_$(date +%F).sql
```
- 진행 중인 배포·마이그레이션이 없는지 확인하고 코드 동결 상태에서 진행한다.

### 1단계: 기존 이력 비우기 (테이블은 안 건드림)
파일을 지우기 **전에** 기존 DB 가 있는 모든 환경에서 실행한다.
```bash
docker exec -it <backend_container> python manage.py migrate --fake api zero
```
- `--fake ... zero` = 테이블은 그대로 두고 `django_migrations` 의 `api` 레코드만 제거.
- **운영·개발·CI 등 기존 DB 가 있는 모든 환경에서 각각 실행** (한 곳이라도 빠지면 그 환경이 깨진다).

### 2단계: 마이그레이션 파일 전부 삭제
`__init__.py` 만 남기고 전부 삭제한다.
```bash
git rm backend/api/migrations/0*.py
```

### 3단계: 새 초기 마이그레이션 생성
```bash
docker exec -it <backend_container> python manage.py makemigrations api
```
- 현재 `models.py` 기준으로 `0001_initial` 하나가 생성된다.

### 4단계: 기존 DB 에 fake 적용
```bash
docker exec -it <backend_container> python manage.py migrate --fake-initial api
```
- 기존 DB 가 있는 **모든 환경에서 각각 실행**.
- **신규 빈 DB 는 fake 없이** 그냥 `migrate` 하면 `0001_initial` 이 정상 적용된다.

### 5단계: 검증
```bash
docker exec -it <backend_container> python manage.py makemigrations --check --dry-run   # "No changes" 정상
docker exec -it <backend_container> python manage.py showmigrations api                 # 0001_initial [X] 하나만
docker exec -it <backend_container> python manage.py test
```

---

## 4. 주의사항

- **백업 없이 진행하지 않는다.**
- 완전 리셋의 유일한 큰 위험은 **환경 누락**이다. 운영·스테이징·CI·동료 로컬 등
  기존 DB 가 있는 모든 곳에서 1·4단계를 빠짐없이 수행한다.
- 잘못되면 0단계 백업으로 복구하거나 `django_migrations` 를 백업 기준으로 되돌린다.
- DB 레코드 삭제(`DELETE FROM django_migrations ...`)를 직접 수행할 경우 반드시
  백업 후 진행한다.
- 정리 후 `makemigrations --check` 가 "No changes" 가 아니면 `models.py` 와
  마이그레이션 간 불일치이므로 원인을 먼저 해결한다.
