# Generated for personalmarkcategory color: theme-token choices -> free hex value
# (테마 색상/표준 색상 팔레트 중 택1, 공지 작성 에디터와 같은 값 체계)

import django.core.validators
from django.db import migrations, models


SEMANTIC_TO_HEX = {
    'danger': '#dc2626',
    'warning': '#d97706',
    'success': '#059669',
    'accent': '#2563eb',
    'pause': '#92600a',
}

HEX_TO_SEMANTIC = {v: k for k, v in SEMANTIC_TO_HEX.items()}


def semantic_to_hex(apps, schema_editor):
    PersonalMarkCategory = apps.get_model('api', 'PersonalMarkCategory')
    for key, hex_value in SEMANTIC_TO_HEX.items():
        PersonalMarkCategory.objects.filter(color=key).update(color=hex_value)


def hex_to_semantic(apps, schema_editor):
    PersonalMarkCategory = apps.get_model('api', 'PersonalMarkCategory')
    for hex_value, key in HEX_TO_SEMANTIC.items():
        PersonalMarkCategory.objects.filter(color=hex_value).update(color=key)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0036_alter_mailnotification_event_type"),
    ]

    operations = [
        migrations.RunPython(semantic_to_hex, hex_to_semantic),
        migrations.AlterField(
            model_name="personalmarkcategory",
            name="color",
            field=models.CharField(
                max_length=7,
                validators=[
                    django.core.validators.RegexValidator(
                        "^#[0-9A-Fa-f]{6}$",
                        message="색상은 #RRGGBB 형식의 hex 값이어야 합니다.",
                    )
                ],
                verbose_name="범주 색(테마 색상/표준 색상 팔레트 중 택1, hex)",
            ),
        ),
    ]
