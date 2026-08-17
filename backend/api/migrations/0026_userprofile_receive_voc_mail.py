from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0025_alter_pauserequest_state'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='receive_voc_mail',
            field=models.BooleanField(default=True, verbose_name='VOC 메일 수신'),
        ),
    ]
