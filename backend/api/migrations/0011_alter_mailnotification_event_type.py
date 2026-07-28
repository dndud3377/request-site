from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0010_designrule'),
    ]

    operations = [
        migrations.AlterField(
            model_name='mailnotification',
            name='event_type',
            field=models.CharField(choices=[('stage_arrival', '단계 도착'), ('rejected', '반려'), ('approved', '승인 완료'), ('notify_submitted', '상신 통보(통보처)'), ('notify_approved', '결재 완료 통보(통보처)'), ('voc_created', 'VOC 등록'), ('voc_comment', 'VOC 댓글'), ('map_apply_failed', '완성 MAP 반영 실패')], max_length=20, verbose_name='이벤트 유형'),
        ),
    ]
