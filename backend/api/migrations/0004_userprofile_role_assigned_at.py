from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_addressbook'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='role_assigned_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='역할 배정 시각'),
        ),
    ]
