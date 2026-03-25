from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='CombinationProduct',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('line', models.CharField(max_length=50, verbose_name='라인')),
                ('combination', models.CharField(max_length=200, verbose_name='조합법')),
                ('product_name', models.CharField(max_length=200, verbose_name='제품이름')),
                ('last_synced', models.DateTimeField(auto_now=True, verbose_name='동기화 시각')),
            ],
            options={
                'verbose_name': '조합법-제품이름 캐시',
                'verbose_name_plural': '조합법-제품이름 캐시 목록',
            },
        ),
        migrations.CreateModel(
            name='ProductCooking',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('line', models.CharField(max_length=50, verbose_name='라인')),
                ('product_name', models.CharField(max_length=200, verbose_name='제품이름')),
                ('cooking_method', models.CharField(max_length=200, verbose_name='조리법')),
                ('last_synced', models.DateTimeField(auto_now=True, verbose_name='동기화 시각')),
            ],
            options={
                'verbose_name': '제품이름-조리법 캐시',
                'verbose_name_plural': '제품이름-조리법 캐시 목록',
            },
        ),
        migrations.AddIndex(
            model_name='combinationproduct',
            index=models.Index(fields=['line'], name='api_combin_line_idx'),
        ),
        migrations.AddIndex(
            model_name='combinationproduct',
            index=models.Index(fields=['line', 'combination'], name='api_combin_line_comb_idx'),
        ),
        migrations.AddIndex(
            model_name='productcooking',
            index=models.Index(fields=['line'], name='api_prodco_line_idx'),
        ),
        migrations.AddIndex(
            model_name='productcooking',
            index=models.Index(fields=['line', 'product_name'], name='api_prodco_line_prod_idx'),
        ),
    ]
