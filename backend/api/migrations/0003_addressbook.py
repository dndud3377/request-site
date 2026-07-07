import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0002_add_voc_comment_author_email'),
    ]

    operations = [
        migrations.CreateModel(
            name='AddressBook',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100, verbose_name='주소록 이름')),
                ('members', models.TextField(blank=True, default='[]', verbose_name='구성원 목록(JSON: [{loginid, name}])')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='생성일')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='수정일')),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='address_books', to=settings.AUTH_USER_MODEL, verbose_name='소유자')),
            ],
            options={
                'verbose_name': '주소록',
                'verbose_name_plural': '주소록 목록',
                'ordering': ['-updated_at'],
                'unique_together': {('owner', 'name')},
            },
        ),
    ]
