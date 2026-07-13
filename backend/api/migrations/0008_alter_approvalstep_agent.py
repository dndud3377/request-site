from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0007_alter_requestdocument_title'),
    ]

    operations = [
        migrations.AlterField(
            model_name='approvalstep',
            name='agent',
            field=models.CharField(
                choices=[
                    ('PL', '검토'),
                    ('R', '{{agent_R}}'),
                    ('RV', '검토자'),
                    ('P', '{{agent_P}}'),
                    ('J', '{{agent_J}}'),
                    ('O', '{{agent_O}}'),
                    ('E', '{{agent_E}}'),
                    ('RA', '후결자'),
                ],
                max_length=2, verbose_name='담당 에이전트',
            ),
        ),
    ]
