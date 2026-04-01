# Migration for StepInfo model

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0002_add_combination_product_cooking_cache'),
    ]

    operations = [
        migrations.CreateModel(
            name='StepInfo',
            fields=[
                ('product_name', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='제품 이름')),
                ('line', models.CharField(max_length=50, verbose_name='라인')),
                ('cooking_method', models.CharField(max_length=200, verbose_name='조리법')),
                ('cooking_methodid', models.CharField(max_length=200, verbose_name='조리법 ID')),
                ('step', models.CharField(max_length=200, verbose_name='단계')),
                ('combination', models.CharField(max_length=200, verbose_name='조합법')),
                ('recipeid', models.CharField(max_length=200, verbose_name='레시피')),
                ('last_synced', models.DateTimeField(auto_now=True, verbose_name='조회 시각')),
            ],
            options={
                'verbose_name': '단계 정보',
                'verbose_name_plural': '단계 정보 목록',
            },
        ),
        migrations.AddIndex(
            model_name='stepinfo',
            index=models.Index(fields=['line', 'cooking_method'], name='api_stepinf_line_process_idx'),
        ),
    ]
