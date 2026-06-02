from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0008_update_productbarcode'),
    ]

    operations = [
        migrations.AddField(
            model_name='productbarcode',
            name='n7cancel_ok',
            field=models.CharField(blank=True, max_length=200, null=True, verbose_name='Cancel OK'),
        ),
    ]
