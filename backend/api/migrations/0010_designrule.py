from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0009_alter_approvalstep_agent'),
    ]

    operations = [
        migrations.CreateModel(
            name='DesignRule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('process', models.CharField(max_length=200, verbose_name='공정')),
                ('design_rule', models.CharField(max_length=200, verbose_name='디자인룰')),
                ('last_synced', models.DateTimeField(auto_now=True, verbose_name='동기화 시각')),
            ],
            options={
                'verbose_name': '공정-디자인룰 캐시',
                'verbose_name_plural': '공정-디자인룰 캐시 목록',
            },
        ),
        migrations.AddIndex(
            model_name='designrule',
            index=models.Index(fields=['process'], name='api_designrule_process_idx'),
        ),
    ]
