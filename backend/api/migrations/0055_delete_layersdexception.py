# claude 수정 (2026-10-14): SD-Layer 검사·예외 기능 삭제 — 모델은 Django 상태에서만 지우고
# DB 테이블(api_layersdexception)과 데이터는 그대로 둔다(재설계 시 참고용). 테이블 DROP 은 별도 결정 사항.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0054_layersdexception_request_agree"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.DeleteModel(
                    name="LayerSdException",
                ),
            ],
            database_operations=[],
        ),
    ]
