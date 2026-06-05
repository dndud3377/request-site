from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0011_add_holiday_and_approvalstep_due_date'),
    ]

    operations = [
        migrations.CreateModel(
            name='Guide',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('guide_type', models.CharField(
                    choices=[('feature', '기능 가이드'), ('info', '정보 가이드')],
                    default='info', max_length=10, verbose_name='가이드 유형'
                )),
                ('feature_key', models.CharField(
                    blank=True, max_length=100, null=True, unique=True, verbose_name='기능 키'
                )),
                ('title', models.CharField(max_length=200, verbose_name='제목')),
                ('content', models.TextField(verbose_name='내용 (HTML)')),
                ('author_name', models.CharField(max_length=100, verbose_name='작성자 이름')),
                ('author_role', models.CharField(max_length=20, verbose_name='작성자 역할')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='작성일')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='수정일')),
            ],
            options={
                'verbose_name': '가이드',
                'verbose_name_plural': '가이드 목록',
                'ordering': ['-created_at'],
            },
        ),
    ]
