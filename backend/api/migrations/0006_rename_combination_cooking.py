from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0005_rename_cooking_fields'),
    ]

    operations = [
        # CombinationProduct → ProcessProduct
        migrations.RenameModel(
            old_name='CombinationProduct',
            new_name='ProcessProduct',
        ),
        # ProcessProduct.combination → process
        migrations.RenameField(
            model_name='ProcessProduct',
            old_name='combination',
            new_name='process',
        ),
        # ProductCooking → ProductProcessId
        migrations.RenameModel(
            old_name='ProductCooking',
            new_name='ProductProcessId',
        ),
        # StepInfo.combination → process
        migrations.RenameField(
            model_name='StepInfo',
            old_name='combination',
            new_name='process',
        ),
    ]
