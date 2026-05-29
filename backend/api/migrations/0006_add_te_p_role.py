from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0005_approvalstep_round_created_at'),
    ]

    operations = [
        migrations.AlterField(
            model_name='userprofile',
            name='role',
            field=models.CharField(
                choices=[
                    ('NONE', 'NONE'), ('PL', 'PL'), ('TE_R', 'TE_R'), ('TE_P', 'TE_P'),
                    ('TE_J', 'TE_J'), ('TE_O', 'TE_O'), ('TE_E', 'TE_E'), ('MASTER', 'MASTER'),
                ],
                default='NONE',
                max_length=10,
                verbose_name='역할',
            ),
        ),
        migrations.AlterField(
            model_name='approvalstep',
            name='agent',
            field=models.CharField(
                choices=[
                    ('R', '{{agent_R}}'),
                    ('P', '{{agent_P}}'),
                    ('J', '{{agent_J}}'),
                    ('O', '{{agent_O}}'),
                    ('E', '{{agent_E}}'),
                ],
                max_length=2,
                verbose_name='담당 에이전트',
            ),
        ),
    ]
