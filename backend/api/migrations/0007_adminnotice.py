from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0006_rename_combination_cooking'),
    ]

    operations = [
        migrations.CreateModel(
            name='AdminNotice',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('template', models.CharField(
                    choices=[('notice', 'Notice'), ('release_note', 'Release Note')],
                    max_length=20,
                    verbose_name='템플릿',
                )),
                ('date', models.DateField(verbose_name='날짜')),
                ('title', models.CharField(max_length=200, verbose_name='제목')),
                ('content', models.TextField(blank=True, verbose_name='내용')),
                ('items', models.JSONField(default=list, verbose_name='항목')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='작성일')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='수정일')),
            ],
            options={
                'verbose_name': '공지사항',
                'verbose_name_plural': '공지사항 목록',
                'ordering': ['-date', '-created_at'],
            },
        ),
    ]
