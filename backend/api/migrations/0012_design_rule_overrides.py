from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    """디자인룰 수동 매핑 테이블 2종 추가.

    첫 AlterField 는 이 기능과 무관한 기존 드리프트 정리다 —
    RequestDocument.production_date 의 verbose_name 이 모델에서만 바뀌고
    마이그레이션에 반영되지 않아 매 makemigrations 마다 재검출되던 항목으로,
    verbose_name 은 Django 상태값이라 실제 SQL 은 발생하지 않는다.
    """

    dependencies = [
        ('api', '0011_alter_mailnotification_event_type'),
    ]

    operations = [
        migrations.AlterField(
            model_name='requestdocument',
            name='production_date',
            field=models.DateField(blank=True, null=True, verbose_name='실제 생산 진행 날짜'),
        ),
        migrations.CreateModel(
            name='ProcessDesignRuleOverride',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('process', models.CharField(max_length=200, unique=True, verbose_name='{{request.process_selection}}')),
                ('design_rule', models.CharField(max_length=200, verbose_name='디자인룰')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='등록일시')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='수정일시')),
                ('created_by', models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name='process_design_rule_overrides', to=settings.AUTH_USER_MODEL,
                    verbose_name='등록자')),
            ],
            options={
                'verbose_name': '{{request.process_selection}}-디자인룰 수동 매핑',
                'verbose_name_plural': '{{request.process_selection}}-디자인룰 수동 매핑 목록',
                'ordering': ['process'],
            },
        ),
        migrations.CreateModel(
            name='DocumentDesignRuleOverride',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('design_rule', models.CharField(max_length=200, verbose_name='디자인룰')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='등록일시')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='수정일시')),
                ('created_by', models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name='document_design_rule_overrides', to=settings.AUTH_USER_MODEL,
                    verbose_name='등록자')),
                ('document', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='design_rule_override', to='api.requestdocument',
                    verbose_name='의뢰서')),
            ],
            options={
                'verbose_name': '의뢰서-디자인룰 수동 매핑',
                'verbose_name_plural': '의뢰서-디자인룰 수동 매핑 목록',
                'ordering': ['-updated_at'],
            },
        ),
    ]
