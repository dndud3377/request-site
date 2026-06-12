from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0015_peer_review_pl'),
    ]

    operations = [
        migrations.AddField(
            model_name='productbarcode',
            name='n7material_spec',
            field=models.CharField(blank=True, max_length=500, null=True, verbose_name='Material Spec'),
        ),
    ]
