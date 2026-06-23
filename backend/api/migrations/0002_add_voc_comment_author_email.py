from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='voccomment',
            name='author_email',
            field=models.EmailField(blank=True, default='', max_length=254, verbose_name='작성자 이메일'),
        ),
    ]
