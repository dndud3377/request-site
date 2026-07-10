import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0005_alter_mailnotification_event_type'),
    ]

    operations = [
        migrations.AlterField(
            model_name='requestdocument',
            name='status',
            field=models.CharField(
                choices=[
                    ('draft', '임시저장'),
                    ('submitted', '상신됨'),
                    ('under_review', '검토중'),
                    ('pause', '중단'),
                    ('approved', '승인됨'),
                    ('rejected', '반려됨'),
                ],
                default='draft', max_length=20, verbose_name='상태',
            ),
        ),
        migrations.CreateModel(
            name='PauseRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('requester_name', models.CharField(blank=True, max_length=100, verbose_name='요청자 이름')),
                ('reason', models.TextField(verbose_name='중단 사유')),
                ('round', models.PositiveSmallIntegerField(default=1, verbose_name='요청 회차')),
                ('state', models.CharField(choices=[('requested', '요청됨'), ('confirmed', '중단됨'), ('cancelled', '취소됨'), ('resumed', '재개됨')], default='requested', max_length=10, verbose_name='상태')),
                ('target_step_ids', models.JSONField(default=list, verbose_name='대상 단계 id')),
                ('confirmed_step_ids', models.JSONField(default=list, verbose_name='확인된 단계 id')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='요청일시')),
                ('confirmed_at', models.DateTimeField(blank=True, null=True, verbose_name='중단 확정일시')),
                ('document', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='pause_requests', to='api.requestdocument', verbose_name='의뢰서')),
                ('requester', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='pause_requests', to=settings.AUTH_USER_MODEL, verbose_name='요청자')),
            ],
            options={
                'verbose_name': '중단 요청',
                'verbose_name_plural': '중단 요청 목록',
                'ordering': ['-created_at'],
            },
        ),
    ]
