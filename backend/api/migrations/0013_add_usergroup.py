from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0012_add_guide_model'),
    ]

    operations = [
        migrations.CreateModel(
            name='UserGroup',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100, verbose_name='그룹 이름')),
                ('creator', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='created_groups',
                    to=settings.AUTH_USER_MODEL,
                    verbose_name='생성자',
                )),
                ('members', models.ManyToManyField(
                    blank=True,
                    related_name='member_groups',
                    to=settings.AUTH_USER_MODEL,
                    verbose_name='그룹 멤버',
                )),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='생성일')),
            ],
            options={
                'verbose_name': '나만의 그룹',
                'verbose_name_plural': '나만의 그룹 목록',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AlterUniqueTogether(
            name='usergroup',
            unique_together={('creator', 'name')},
        ),
    ]
