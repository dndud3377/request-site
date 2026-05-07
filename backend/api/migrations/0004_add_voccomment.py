from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_add_voc_page_submitter'),
    ]

    operations = [
        migrations.CreateModel(
            name='VocComment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('author_name', models.CharField(max_length=100, verbose_name='작성자')),
                ('author_role', models.CharField(max_length=20, verbose_name='역할')),
                ('is_submitter', models.BooleanField(default=False, verbose_name='제출자 여부')),
                ('content', models.TextField(verbose_name='내용')),
                ('is_reject_reason', models.BooleanField(default=False, verbose_name='반려 사유 여부')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='작성일시')),
                ('voc', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='comments',
                    to='api.voc',
                    verbose_name='VOC',
                )),
            ],
            options={
                'verbose_name': 'VOC 댓글',
                'verbose_name_plural': 'VOC 댓글 목록',
                'ordering': ['created_at'],
            },
        ),
    ]
