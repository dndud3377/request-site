from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0006_add_te_p_role'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProductBarcode',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('n7mto_date', models.CharField(max_length=200, verbose_name='MTO Date')),
                ('n7c_layer_num', models.CharField(max_length=200, verbose_name='Layer Num')),
                ('n7prod_code', models.CharField(max_length=200, verbose_name='Product Code')),
                ('last_synced', models.DateTimeField(auto_now=True, verbose_name='동기화 시각')),
            ],
            options={
                'verbose_name': '바코드-품목 캐시',
                'verbose_name_plural': '바코드-품목 캐시 목록',
            },
        ),
    ]
