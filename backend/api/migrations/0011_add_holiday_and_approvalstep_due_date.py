from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0010_requestdocument_production_date'),
    ]

    operations = [
        migrations.CreateModel(
            name='Holiday',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('date_name', models.CharField(max_length=100, verbose_name='공휴일명')),
                ('isholiday', models.CharField(max_length=1, verbose_name='공휴일 여부')),
                ('act_date', models.DateField(unique=True, verbose_name='날짜')),
            ],
            options={
                'verbose_name': '공휴일',
                'verbose_name_plural': '공휴일 목록',
            },
        ),
        migrations.AddIndex(
            model_name='holiday',
            index=models.Index(fields=['act_date'], name='api_holiday_act_date_idx'),
        ),
        migrations.AddField(
            model_name='approvalstep',
            name='due_date',
            field=models.DateField(blank=True, null=True, verbose_name='완료 기한'),
        ),
    ]
