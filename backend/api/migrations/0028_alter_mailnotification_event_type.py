from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0027_alter_mailnotification_event_type'),
    ]

    operations = [
        migrations.AlterField(
            model_name='mailnotification',
            name='event_type',
            field=models.CharField(
                choices=[
                    ('stage_arrival', '단계 도착'),
                    ('rejected', '반려'),
                    ('approved', '승인 완료'),
                    ('notify_submitted', '상신 통보(통보처)'),
                    ('notify_approved', '결재 완료 통보(통보처)'),
                    ('withdraw_requested', '철회 요청'),
                    ('withdraw_completed', '철회 완료'),
                    ('withdraw_rejected', '철회 거부'),
                    ('withdraw_cancelled', '철회 요청 취소'),
                    ('voc_created', 'VOC 등록'),
                    ('voc_comment', 'VOC 댓글'),
                    ('rtdb_sync_failed', 'RTDB 동기화 실패'),
                    ('dcq_sync_failed', 'DCQ 동기화 실패'),
                ],
                max_length=20,
                verbose_name='이벤트 유형',
            ),
        ),
    ]
