from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0009_update_productbarcode'),
    ]

    operations = [
        migrations.AddField(
            model_name='requestdocument',
            name='production_date',
            field=models.DateField(blank=True, null=True, verbose_name='실제 생산 진행 날짜'),
        ),
    ]
