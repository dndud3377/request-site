from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0013_add_usergroup'),
    ]

    operations = [
        migrations.CreateModel(
            name='MapName',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('lineid', models.CharField(max_length=50, verbose_name='라인 ID')),
                ('partid', models.CharField(max_length=200, verbose_name='Part ID')),
                ('last_synced', models.DateTimeField(auto_now=True, verbose_name='동기화 시각')),
            ],
            options={
                'verbose_name': 'MAP 이름 캐시',
                'verbose_name_plural': 'MAP 이름 캐시 목록',
            },
        ),
        migrations.AddIndex(
            model_name='mapname',
            index=models.Index(fields=['lineid'], name='api_mapname_lineid_idx'),
        ),
    ]
