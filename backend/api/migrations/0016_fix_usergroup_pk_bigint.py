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

MySQL 전용이다 — sqlite(로컬/CI 테스트)는애초에 int/bigint 구분이 없어 이 드리프트가
발생할 수 없으므로 vendor 체크로 건너뛴다.
"""

from django.db import migrations


def fix_usergroup_pk_to_bigint(apps, schema_editor):
    if schema_editor.connection.vendor != "mysql":
        return
    with schema_editor.connection.cursor() as cursor:
        # FK 제약이 걸린 컬럼(usergroup_id)과 그 대상(id)의 타입을 동시에 바꿔야 하므로
        # 잠깐 FK 체크를 끈다. 컬럼을 넓히는(int→bigint) 변경이라 기존 데이터는 안전하다.
        cursor.execute("SET FOREIGN_KEY_CHECKS=0")
        cursor.execute("ALTER TABLE api_usergroup MODIFY id BIGINT NOT NULL AUTO_INCREMENT")
        cursor.execute("ALTER TABLE api_usergroup_members MODIFY usergroup_id BIGINT NOT NULL")
        cursor.execute("SET FOREIGN_KEY_CHECKS=1")


def reverse_usergroup_pk_to_bigint(apps, schema_editor):
    if schema_editor.connection.vendor != "mysql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SET FOREIGN_KEY_CHECKS=0")
        cursor.execute("ALTER TABLE api_usergroup_members MODIFY usergroup_id INT NOT NULL")
        cursor.execute("ALTER TABLE api_usergroup MODIFY id INT NOT NULL AUTO_INCREMENT")
        cursor.execute("SET FOREIGN_KEY_CHECKS=1")


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0015_alter_approvalstep_action"),
    ]

    operations = [
        migrations.RunPython(fix_usergroup_pk_to_bigint, reverse_usergroup_pk_to_bigint),
    ]
