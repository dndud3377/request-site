from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0006_pauserequest'),
    ]

    operations = [
        migrations.AlterField(
            model_name='requestdocument',
            name='title',
            field=models.CharField(max_length=600, verbose_name='의뢰서 제목'),
        ),
    ]
