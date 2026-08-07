# Hand-written (not `makemigrations` generated).
"""api_usergroup / api_usergroup_members 컬럼 타입 실측 드리프트 수정.

배경: 0001_initial.py 는 UserGroup.id 를 BigAutoField(bigint) 로 "기록"하고 있지만,
실제 운영 MySQL 에서는 api_usergroup.id 와 M2M 중간 테이블
api_usergroup_members.usergroup_id 가 모두 **int** 로 남아 있었다(마이그레이션 상태와
실제 스키마의 드리프트 — 이 저장소 마이그레이션 히스토리가 실제 운영 히스토리를 그대로
반영한 게 아닐 가능성이 큼, 0001_initial.py 상단 "MASKING 처리된 파일" 참고).

RequestDocument.shared_group(bigint FK, 다음 마이그레이션 0017)을 api_usergroup.id(int)
에 추가하려다 MySQL 3780(FK 컬럼 타입 불일치)으로 실패해 발견됐다. UserGroup 을 향하는
FK 가 생긴 건 0017 이 처음이라 그 전까지는 드러나지 않았을 뿐, 원래 있던 문제다.
그래서 0017 보다 먼저 적용되도록 0016 으로 끼워 넣는다.

Django 의 `AlterField` 는 "이전 마이그레이션 상태"와 비교해 변경분만 SQL로 만드는데,
상태는 처음부터 BigAutoField 라고 기록돼 있어 AlterField 로는 실제 ALTER 문이 전혀
나오지 않는다(상태상 무변경으로 판단). 그래서 RunPython + raw SQL 로 강제 정정한다.

MySQL 전용이다 — sqlite(로컬/CI 테스트)는 애초에 int/bigint 구분이 없어 이 드리프트가
발생할 수 없으므로 vendor 체크로 건너뛴다.

⚠️ 1차 시도(FOREIGN_KEY_CHECKS=0 만으로 두 컬럼을 MODIFY)는 3780 에러로 실패했다.
MySQL/InnoDB 에서 FOREIGN_KEY_CHECKS 는 DML 참조무결성 검사만 끌 뿐, ALTER TABLE
시점에 InnoDB 가 수행하는 "FK 로 연결된 두 컬럼의 타입이 서로 맞는가" DDL 검증은
끄지 못한다. 그래서 이번엔 제약을 실제로 DROP 했다가 두 컬럼을 바꾸고 다시 ADD 한다.
"""

from django.db import migrations

_FK_LOOKUP_SQL = """
    SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'api_usergroup_members'
      AND COLUMN_NAME = 'usergroup_id'
      AND REFERENCED_TABLE_NAME = 'api_usergroup'
"""


def _find_fk_name(cursor):
    cursor.execute(_FK_LOOKUP_SQL)
    row = cursor.fetchone()
    return row[0] if row else None


def fix_usergroup_pk_to_bigint(apps, schema_editor):
    if schema_editor.connection.vendor != "mysql":
        return
    with schema_editor.connection.cursor() as cursor:
        # 이름을 하드코딩하지 않고 조회한다 — Django 가 자동 생성하는 제약 이름은
        # 테이블/컬럼명 해시가 붙어 환경마다 달라질 수 있다.
        fk_name = _find_fk_name(cursor)
        if fk_name:
            cursor.execute(f"ALTER TABLE api_usergroup_members DROP FOREIGN KEY `{fk_name}`")

        cursor.execute("ALTER TABLE api_usergroup MODIFY id BIGINT NOT NULL AUTO_INCREMENT")
        cursor.execute("ALTER TABLE api_usergroup_members MODIFY usergroup_id BIGINT NOT NULL")

        if fk_name:
            cursor.execute(
                f"ALTER TABLE api_usergroup_members "
                f"ADD CONSTRAINT `{fk_name}` FOREIGN KEY (usergroup_id) "
                f"REFERENCES api_usergroup (id) ON DELETE CASCADE"
            )


def reverse_usergroup_pk_to_bigint(apps, schema_editor):
    if schema_editor.connection.vendor != "mysql":
        return
    with schema_editor.connection.cursor() as cursor:
        fk_name = _find_fk_name(cursor)
        if fk_name:
            cursor.execute(f"ALTER TABLE api_usergroup_members DROP FOREIGN KEY `{fk_name}`")

        cursor.execute("ALTER TABLE api_usergroup_members MODIFY usergroup_id INT NOT NULL")
        cursor.execute("ALTER TABLE api_usergroup MODIFY id INT NOT NULL AUTO_INCREMENT")

        if fk_name:
            cursor.execute(
                f"ALTER TABLE api_usergroup_members "
                f"ADD CONSTRAINT `{fk_name}` FOREIGN KEY (usergroup_id) "
                f"REFERENCES api_usergroup (id) ON DELETE CASCADE"
            )


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0015_alter_approvalstep_action"),
    ]

    operations = [
        migrations.RunPython(fix_usergroup_pk_to_bigint, reverse_usergroup_pk_to_bigint),
    ]
