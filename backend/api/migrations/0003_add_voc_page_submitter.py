from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0002_add_userprofile'),
    ]

    operations = [
        migrations.AddField(
            model_name='voc',
            name='submitter_user_id',
            field=models.IntegerField(blank=True, null=True, verbose_name='제출자 ID'),
        ),
        migrations.AddField(
            model_name='voc',
            name='page',
            field=models.CharField(blank=True, default='', max_length=20, verbose_name='관련 페이지'),
        ),
    ]
