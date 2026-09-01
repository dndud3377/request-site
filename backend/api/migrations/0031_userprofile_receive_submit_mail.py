from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0030_layerfilterset'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='receive_submit_mail',
            field=models.BooleanField(default=False, verbose_name='상신 메일 수신'),
        ),
    ]
