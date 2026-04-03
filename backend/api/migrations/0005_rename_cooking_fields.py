from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0004_rename_api_combin_line_idx_api_combina_line_08884f_idx_and_more'),
    ]

    operations = [
        # ProductCooking: cooking_method → process_id
        migrations.RenameField(
            model_name='productcooking',
            old_name='cooking_method',
            new_name='process_id',
        ),
        # StepInfo: cooking_method → process_id
        migrations.RenameField(
            model_name='stepinfo',
            old_name='cooking_method',
            new_name='process_id',
        ),
        # StepInfo: cooking_methodid → processid
        migrations.RenameField(
            model_name='stepinfo',
            old_name='cooking_methodid',
            new_name='processid',
        ),
    ]
