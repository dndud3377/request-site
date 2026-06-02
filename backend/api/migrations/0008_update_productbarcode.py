from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0007_add_productbarcode'),
    ]

    operations = [
        migrations.AlterField(
            model_name='productbarcode',
            name='n7mto_date',
            field=models.CharField(blank=True, max_length=200, null=True, verbose_name='MTO Date'),
        ),
        migrations.AddField(
            model_name='productbarcode',
            name='n7cancel_date',
            field=models.CharField(blank=True, max_length=200, null=True, verbose_name='Cancel Date'),
        ),
        migrations.AddField(
            model_name='productbarcode',
            name='n7barcode',
            field=models.CharField(default='', max_length=200, verbose_name='Barcode'),
            preserve_default=False,
        ),
    ]
