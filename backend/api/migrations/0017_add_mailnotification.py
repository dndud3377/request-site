import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0016_add_productbarcode_material_spec'),
    ]

    operations = [
        migrations.CreateModel(
            name='MailNotification',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('event_type', models.CharField(
                    choices=[
                        ('stage_arrival', '단계 도착'),
                        ('rejected', '반려'),
                        ('approved', '승인 완료'),
                    ],
                    max_length=20,
                    verbose_name='이벤트 유형',
                )),
                ('recipients', models.JSONField(default=list, verbose_name='수신자 이메일 목록')),
                ('subject', models.CharField(max_length=500, verbose_name='제목')),
                ('contents', models.TextField(verbose_name='본문(HTML)')),
                ('status', models.CharField(
                    choices=[
                        ('pending', '대기'),
                        ('sent', '발송 완료'),
                        ('failed', '발송 실패'),
                    ],
                    default='pending',
                    max_length=10,
                    verbose_name='상태',
                )),
                ('attempts', models.PositiveSmallIntegerField(default=0, verbose_name='시도 횟수')),
                ('max_attempts', models.PositiveSmallIntegerField(default=5, verbose_name='최대 시도 횟수')),
                ('last_error', models.TextField(blank=True, verbose_name='마지막 에러')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='적재일시')),
                ('sent_at', models.DateTimeField(blank=True, null=True, verbose_name='발송일시')),
                ('document', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='mail_notifications',
                    to='api.requestdocument',
                    verbose_name='의뢰서',
                )),
            ],
            options={
                'verbose_name': '결재 알림 메일',
                'verbose_name_plural': '결재 알림 메일 목록',
                'ordering': ['created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='mailnotification',
            index=models.Index(fields=['status'], name='api_mailnoti_status_idx'),
        ),
    ]
