from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0008_alter_approvalstep_agent'),
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
                    ('PV', '검토자'),
                    ('J', '{{agent_J}}'),
                    ('O', '{{agent_O}}'),
                    ('E', '{{agent_E}}'),
                    ('EV', '검토자'),
                    ('RA', '후결자'),
                ],
                max_length=2, verbose_name='담당 에이전트',
            ),
        ),
    ]
