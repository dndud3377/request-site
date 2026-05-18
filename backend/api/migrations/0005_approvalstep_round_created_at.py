from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0004_add_voccomment'),
    ]

    operations = [
        migrations.AddField(
            model_name='approvalstep',
            name='round',
            field=models.PositiveSmallIntegerField(default=1, verbose_name='상신 회차'),
        ),
        migrations.AddField(
            model_name='approvalstep',
            name='created_at',
            field=models.DateTimeField(auto_now_add=True, null=True, blank=True, verbose_name='생성일시'),
            preserve_default=False,
        ),
        migrations.AlterModelOptions(
            name='approvalstep',
            options={
                'ordering': ['round', 'id'],
                'verbose_name': '결재 단계',
                'verbose_name_plural': '결재 단계 목록',
            },
        ),
    ]
