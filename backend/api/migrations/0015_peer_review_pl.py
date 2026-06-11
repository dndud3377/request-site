import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0014_add_mapname'),
    ]

    operations = [
        migrations.AddField(
            model_name='requestdocument',
            name='designated_pl',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='designated_reviews',
                to=settings.AUTH_USER_MODEL,
                verbose_name='지정 PL',
            ),
        ),
        migrations.AddField(
            model_name='requestdocument',
            name='designated_pl_name',
            field=models.CharField(blank=True, max_length=100, verbose_name='지정 PL 이름'),
        ),
        migrations.AlterField(
            model_name='approvalstep',
            name='agent',
            field=models.CharField(
                choices=[
                    ('PL', '검토'),
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
