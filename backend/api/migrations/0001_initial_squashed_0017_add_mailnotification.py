"""
⚠️ MASKING 처리된 파일

이 파일에 포함된 비즈니스 용어는 {{ko.json}} 키로 마스킹되어 있습니다.
원래 용어를 확인하려면 다음 파일을 참조하세요:
- frontend/src/locales/ko.json

------------------------------------------------------------------------
이 파일은 0001_initial ~ 0017_add_mailnotification 을 압축(squash)한
마이그레이션입니다. (squashmigrations 결과 재현)

- replaces 에 명시된 기존 마이그레이션들이 모두 적용된 DB(운영/개발)에서는
  Django 가 이 압축 마이그레이션을 "적용됨"으로 간주하고 SQL 을 재실행하지
  않습니다. → 무중단.
- 신규 빈 DB 에서는 이 파일 하나만으로 전체 스키마가 생성됩니다.
- 0002 의 RunSQL(CREATE TABLE IF NOT EXISTS) / RunPython(FK 보정)은
  신규 DB 에서는 자동 no-op 이므로 안전하게 보존되어 있습니다.

모든 환경이 이 압축본을 적용 완료한 뒤에는 0001~0017 원본 파일과
아래 replaces 목록을 제거할 수 있습니다.
------------------------------------------------------------------------
"""

import django.contrib.auth.base_user
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
import api.models


# --- 0002_add_userprofile 의 데이터 보정 로직 (운영 DB 호환용, 신규 DB 에선 no-op) ---

CREATE_USERPROFILE_SQL = """
CREATE TABLE IF NOT EXISTS `api_userprofile` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `password` varchar(128) NOT NULL,
  `last_login` datetime(6) DEFAULT NULL,
  `loginid` varchar(150) NOT NULL,
  `mail` varchar(254) NOT NULL,
  `username` varchar(150) NOT NULL,
  `deptname` varchar(200) NOT NULL,
  `role` varchar(10) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `api_userprofile_loginid_uniq` (`loginid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

DROP_USERPROFILE_SQL = "DROP TABLE IF EXISTS `api_userprofile`;"


def fix_fk_to_userprofile(apps, schema_editor):
    """
    On existing DBs, FK constraints on requester_id/assignee_id still point to auth_user.
    Find those constraints and reroute them to api_userprofile.
    On fresh DBs (FK already points to api_userprofile), this is a no-op.
    """
    tables_columns = [
        ('api_requestdocument', 'requester_id'),
        ('api_approvalstep', 'assignee_id'),
        ('api_vochistory', 'assignee_id'),
    ]
    with schema_editor.connection.cursor() as cursor:
        for table, column in tables_columns:
            cursor.execute(
                """
                SELECT CONSTRAINT_NAME
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = %s
                  AND COLUMN_NAME = %s
                  AND REFERENCED_TABLE_NAME = 'auth_user'
                """,
                [table, column],
            )
            row = cursor.fetchone()
            if row:
                cursor.execute(
                    f"ALTER TABLE `{table}` DROP FOREIGN KEY `{row[0]}`"
                )
                cursor.execute(
                    f"""
                    ALTER TABLE `{table}`
                    ADD CONSTRAINT `{table}_{column}_up_fk`
                    FOREIGN KEY (`{column}`) REFERENCES `api_userprofile`(`id`)
                    ON DELETE SET NULL
                    """
                )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    replaces = [
        ('api', '0001_initial'),
        ('api', '0002_add_userprofile'),
        ('api', '0003_add_voc_page_submitter'),
        ('api', '0004_add_voccomment'),
        ('api', '0005_approvalstep_round_created_at'),
        ('api', '0006_add_te_p_role'),
        ('api', '0007_add_productbarcode'),
        ('api', '0008_update_productbarcode'),
        ('api', '0009_update_productbarcode'),
        ('api', '0010_requestdocument_production_date'),
        ('api', '0011_add_holiday_and_approvalstep_due_date'),
        ('api', '0012_add_guide_model'),
        ('api', '0013_add_usergroup'),
        ('api', '0014_add_mapname'),
        ('api', '0015_peer_review_pl'),
        ('api', '0016_add_productbarcode_material_spec'),
        ('api', '0017_add_mailnotification'),
    ]

    initial = True

    dependencies = []

    operations = [
        # ===== 0001_initial =====
        migrations.CreateModel(
            name='UserProfile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('password', models.CharField(max_length=128, verbose_name='password')),
                ('last_login', models.DateTimeField(blank=True, null=True, verbose_name='last login')),
                ('loginid', models.CharField(max_length=150, unique=True, verbose_name='로그인 ID')),
                ('mail', models.EmailField(blank=True, default='', max_length=254, verbose_name='이메일')),
                ('username', models.CharField(blank=True, default='', max_length=150, verbose_name='표시 이름')),
                ('deptname', models.CharField(blank=True, default='', max_length=200, verbose_name='부서명')),
                ('role', models.CharField(choices=[('NONE', 'NONE'), ('PL', 'PL'), ('TE_R', 'TE_R'), ('TE_J', 'TE_J'), ('TE_O', 'TE_O'), ('TE_E', 'TE_E'), ('MASTER', 'MASTER')], default='NONE', max_length=10, verbose_name='역할')),
            ],
            options={
                'verbose_name': '사용자',
                'verbose_name_plural': '사용자 목록',
            },
            managers=[
                ('objects', api.models.UserProfileManager()),
            ],
        ),
        migrations.CreateModel(
            name='AdminNotice',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('template', models.CharField(choices=[('notice', 'Notice'), ('release_note', 'Release Note')], max_length=20, verbose_name='템플릿')),
                ('date', models.DateField(verbose_name='날짜')),
                ('title', models.CharField(max_length=200, verbose_name='제목')),
                ('content', models.TextField(blank=True, verbose_name='내용')),
                ('items', models.JSONField(default=list, verbose_name='항목')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='작성일')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='수정일')),
            ],
            options={
                'verbose_name': '공지사항',
                'verbose_name_plural': '공지사항 목록',
                'ordering': ['-date', '-created_at'],
            },
        ),
        migrations.CreateModel(
            name='Line',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=50, unique=True, verbose_name='{{request.line}} 이름')),
                ('order', models.PositiveSmallIntegerField(default=0, verbose_name='정렬 순서')),
                ('is_active', models.BooleanField(default=True, verbose_name='활성 여부')),
            ],
            options={
                'verbose_name': '{{request.line}}',
                'verbose_name_plural': '{{request.line}} 목록',
                'ordering': ['order', 'name'],
            },
        ),
        migrations.CreateModel(
            name='VOC',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=200, verbose_name='제목')),
                ('category', models.CharField(choices=[('inquiry', '문의'), ('error_report', '오류 신고'), ('feature_request', '기능 제안'), ('task_request', '작업 요청')], max_length=20, verbose_name='유형')),
                ('submitter_name', models.CharField(max_length=100, verbose_name='제출자')),
                ('submitter_email', models.EmailField(max_length=254, verbose_name='이메일')),
                ('content', models.TextField(verbose_name='내용')),
                ('response', models.TextField(blank=True, verbose_name='답변')),
                ('status', models.CharField(choices=[('checking', '확인중'), ('completed', '완료'), ('rejected', '거부')], default='checking', max_length=20, verbose_name='상태')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='접수일')),
                ('responded_at', models.DateTimeField(blank=True, null=True, verbose_name='답변일')),
            ],
            options={
                'verbose_name': 'VOC',
                'verbose_name_plural': 'VOC 목록',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='PhotoStepS1',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('processid', models.CharField(max_length=200, verbose_name='{{request.process_id}} ID')),
                ('stepseq', models.CharField(max_length=200, verbose_name='{{request.col_step}}SEQ')),
                ('descript', models.CharField(max_length=200, verbose_name='{{request.process_selection}}명')),
                ('recipeid', models.CharField(max_length=200, verbose_name='Recipe ID')),
                ('areaname', models.CharField(max_length=50, verbose_name='영역명')),
                ('eqptype', models.CharField(max_length=50, verbose_name='장비 타입')),
                ('layerid', models.CharField(blank=True, max_length=200, verbose_name='레이어 ID')),
                ('updated', models.CharField(blank=True, max_length=50, verbose_name='업데이트')),
                ('last_synced', models.DateTimeField(auto_now=True, verbose_name='동기화 시각')),
            ],
            options={
                'verbose_name': 'line1 {{request.col_step}} 정보',
                'verbose_name_plural': 'line1 {{request.col_step}} 정보 목록',
                'indexes': [models.Index(fields=['processid'], name='api_pstep_line1_processid_idx'), models.Index(fields=['processid', 'eqptype'], name='api_pstep_line1_prcid_eqp_idx')],
            },
        ),
        migrations.CreateModel(
            name='PhotoStepS3',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('processid', models.CharField(max_length=200, verbose_name='{{request.process_id}} ID')),
                ('stepseq', models.CharField(max_length=200, verbose_name='{{request.col_step}}SEQ')),
                ('descript', models.CharField(max_length=200, verbose_name='{{request.process_selection}}명')),
                ('recipeid', models.CharField(max_length=200, verbose_name='Recipe ID')),
                ('areaname', models.CharField(max_length=50, verbose_name='영역명')),
                ('eqptype', models.CharField(max_length=50, verbose_name='장비 타입')),
                ('layerid', models.CharField(blank=True, max_length=200, verbose_name='레이어 ID')),
                ('updated', models.CharField(blank=True, max_length=50, verbose_name='업데이트')),
                ('last_synced', models.DateTimeField(auto_now=True, verbose_name='동기화 시각')),
            ],
            options={
                'verbose_name': 'line3 {{request.col_step}} 정보',
                'verbose_name_plural': 'line3 {{request.col_step}} 정보 목록',
                'indexes': [models.Index(fields=['processid'], name='api_pstep_line3_processid_idx'), models.Index(fields=['processid', 'eqptype'], name='api_pstep_line3_prcid_eqp_idx')],
            },
        ),
        migrations.CreateModel(
            name='PhotoStepS4',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('processid', models.CharField(max_length=200, verbose_name='{{request.process_id}} ID')),
                ('stepseq', models.CharField(max_length=200, verbose_name='{{request.col_step}}SEQ')),
                ('descript', models.CharField(max_length=200, verbose_name='{{request.process_selection}}명')),
                ('recipeid', models.CharField(max_length=200, verbose_name='Recipe ID')),
                ('areaname', models.CharField(max_length=50, verbose_name='영역명')),
                ('eqptype', models.CharField(max_length=50, verbose_name='장비 타입')),
                ('layerid', models.CharField(blank=True, max_length=200, verbose_name='레이어 ID')),
                ('updated', models.CharField(blank=True, max_length=50, verbose_name='업데이트')),
                ('last_synced', models.DateTimeField(auto_now=True, verbose_name='동기화 시각')),
            ],
            options={
                'verbose_name': 'line4 {{request.col_step}} 정보',
                'verbose_name_plural': 'line4 {{request.col_step}} 정보 목록',
                'indexes': [models.Index(fields=['processid'], name='api_pstep_line4_processid_idx'), models.Index(fields=['processid', 'eqptype'], name='api_pstep_line4_prcid_eqp_idx')],
            },
        ),
        migrations.CreateModel(
            name='PhotoStepS5',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('processid', models.CharField(max_length=200, verbose_name='{{request.process_id}} ID')),
                ('stepseq', models.CharField(max_length=200, verbose_name='{{request.col_step}}SEQ')),
                ('descript', models.CharField(max_length=200, verbose_name='{{request.process_selection}}명')),
                ('recipeid', models.CharField(max_length=200, verbose_name='Recipe ID')),
                ('areaname', models.CharField(max_length=50, verbose_name='영역명')),
                ('eqptype', models.CharField(max_length=50, verbose_name='장비 타입')),
                ('layerid', models.CharField(blank=True, max_length=200, verbose_name='레이어 ID')),
                ('updated', models.CharField(blank=True, max_length=50, verbose_name='업데이트')),
                ('last_synced', models.DateTimeField(auto_now=True, verbose_name='동기화 시각')),
            ],
            options={
                'verbose_name': 'line5 {{request.col_step}} 정보',
                'verbose_name_plural': 'line5 {{request.col_step}} 정보 목록',
                'indexes': [models.Index(fields=['processid'], name='api_pstep_line5_processid_idx'), models.Index(fields=['processid', 'eqptype'], name='api_pstep_line5_prcid_eqp_idx')],
            },
        ),
        migrations.CreateModel(
            name='ProcessProduct',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('line', models.CharField(max_length=50, verbose_name='{{request.line}}')),
                ('process', models.CharField(max_length=200, verbose_name='{{request.process_selection}}')),
                ('product_name', models.CharField(max_length=200, verbose_name='{{request.partid_selection}}')),
                ('last_synced', models.DateTimeField(auto_now=True, verbose_name='동기화 시각')),
            ],
            options={
                'verbose_name': '{{request.process_selection}}-{{request.partid_selection}} 캐시',
                'verbose_name_plural': '{{request.process_selection}}-{{request.partid_selection}} 캐시 목록',
                'indexes': [models.Index(fields=['line'], name='api_process_line_664ae4_idx'), models.Index(fields=['line', 'process'], name='api_process_line_978a8a_idx')],
            },
        ),
        migrations.CreateModel(
            name='ProductProcessId',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('line', models.CharField(max_length=50, verbose_name='{{request.line}}')),
                ('product_name', models.CharField(max_length=200, verbose_name='{{request.partid_selection}}')),
                ('process_id', models.CharField(max_length=200, verbose_name='{{request.process_id}}')),
                ('last_synced', models.DateTimeField(auto_now=True, verbose_name='동기화 시각')),
            ],
            options={
                'verbose_name': '{{request.partid_selection}}-{{request.process_id}} 캐시',
                'verbose_name_plural': '{{request.partid_selection}}-{{request.process_id}} 캐시 목록',
                'indexes': [models.Index(fields=['line'], name='api_product_line_aba00c_idx'), models.Index(fields=['line', 'product_name'], name='api_product_line_a981f5_idx')],
            },
        ),
        migrations.CreateModel(
            name='RequestDocument',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=300, verbose_name='의뢰서 제목')),
                ('requester_name', models.CharField(max_length=100, verbose_name='의뢰자 이름')),
                ('requester_email', models.EmailField(max_length=254, verbose_name='의뢰자 이메일')),
                ('requester_department', models.CharField(max_length=100, verbose_name='부서')),
                ('product_name', models.CharField(max_length=200, verbose_name='{{request.partid_selection}}')),
                ('reference_materials', models.TextField(blank=True, verbose_name='참고 자료')),
                ('additional_notes', models.TextField(blank=True, verbose_name='추가 정보(JSON)')),
                ('status', models.CharField(choices=[('draft', '임시저장'), ('submitted', '상신됨'), ('under_review', '검토중'), ('approved', '승인됨'), ('rejected', '반려됨')], default='draft', max_length=20, verbose_name='상태')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='생성일')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='수정일')),
                ('submitted_at', models.DateTimeField(blank=True, null=True, verbose_name='상신일')),
                ('requester', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='requests', to=settings.AUTH_USER_MODEL, verbose_name='의뢰자')),
            ],
            options={
                'verbose_name': '의뢰서',
                'verbose_name_plural': '의뢰서 목록',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='ApprovalStep',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('agent', models.CharField(choices=[('R', '{{agent_R}}'), ('J', '{{agent_J}}'), ('O', '{{agent_O}}'), ('E', '{{agent_E}}')], max_length=2, verbose_name='담당 에이전트')),
                ('action', models.CharField(choices=[('pending', '대기'), ('approved', '합의'), ('rejected', '반려')], default='checking', max_length=10, verbose_name='결재 결과')),
                ('acted_at', models.DateTimeField(blank=True, null=True, verbose_name='처리일시')),
                ('comment', models.TextField(blank=True, verbose_name='의견')),
                ('is_parallel', models.BooleanField(default=False, verbose_name='병렬 처리 여부')),
                ('assignee_name', models.CharField(blank=True, max_length=100, verbose_name='담당자 이름')),
                ('assignee', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='assigned_steps', to=settings.AUTH_USER_MODEL, verbose_name='담당자')),
                ('document', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='approval_steps', to='api.requestdocument', verbose_name='의뢰서')),
            ],
            options={
                'verbose_name': '결재 단계',
                'verbose_name_plural': '결재 단계 목록',
                'ordering': ['id'],
            },
        ),
        migrations.CreateModel(
            name='VocHistory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action', models.CharField(choices=[('checking', '확인중'), ('completed', '완료'), ('rejected', '거부')], default='checking', max_length=20, verbose_name='처리 결과')),
                ('acted_at', models.DateTimeField(auto_now_add=True, verbose_name='처리일시')),
                ('comment', models.TextField(blank=True, verbose_name='의견')),
                ('assignee_name', models.CharField(blank=True, max_length=100, verbose_name='담당자 이름')),
                ('assignee', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='assigned_voc_histories', to=settings.AUTH_USER_MODEL, verbose_name='담당자')),
                ('voc', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='histories', to='api.voc', verbose_name='VOC')),
            ],
            options={
                'verbose_name': 'VOC 처리 이력',
                'verbose_name_plural': 'VOC 처리 이력 목록',
                'ordering': ['-acted_at'],
                'indexes': [models.Index(fields=['voc'], name='api_vochist_voc_idx'), models.Index(fields=['action'], name='api_vochist_action_idx')],
            },
        ),

        # ===== 0002_add_userprofile (운영 DB 보정, 신규 DB 에선 no-op) =====
        migrations.SeparateDatabaseAndState(
            state_operations=[],
            database_operations=[
                migrations.RunSQL(
                    sql=CREATE_USERPROFILE_SQL,
                    reverse_sql=DROP_USERPROFILE_SQL,
                ),
            ],
        ),
        migrations.RunPython(fix_fk_to_userprofile, noop_reverse),

        # ===== 0003_add_voc_page_submitter =====
        migrations.AddField(
            model_name='voc',
            name='submitter_user_id',
            field=models.IntegerField(blank=True, null=True, verbose_name='제출자 ID'),
        ),
        migrations.AddField(
            model_name='voc',
            name='page',
            field=models.CharField(blank=True, default='', max_length=20, verbose_name='관련 페이지'),
        ),

        # ===== 0004_add_voccomment =====
        migrations.CreateModel(
            name='VocComment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('author_name', models.CharField(max_length=100, verbose_name='작성자')),
                ('author_role', models.CharField(max_length=20, verbose_name='역할')),
                ('is_submitter', models.BooleanField(default=False, verbose_name='제출자 여부')),
                ('content', models.TextField(verbose_name='내용')),
                ('is_reject_reason', models.BooleanField(default=False, verbose_name='반려 사유 여부')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='작성일시')),
                ('voc', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='comments',
                    to='api.voc',
                    verbose_name='VOC',
                )),
            ],
            options={
                'verbose_name': 'VOC 댓글',
                'verbose_name_plural': 'VOC 댓글 목록',
                'ordering': ['created_at'],
            },
        ),

        # ===== 0005_approvalstep_round_created_at =====
        migrations.AddField(
            model_name='approvalstep',
            name='round',
            field=models.PositiveSmallIntegerField(default=1, verbose_name='상신 회차'),
        ),
        migrations.AddField(
            model_name='approvalstep',
            name='created_at',
            field=models.DateTimeField(auto_now_add=True, null=True, blank=True, verbose_name='생성일시'),
            preserve_default=False,
        ),
        migrations.AlterModelOptions(
            name='approvalstep',
            options={
                'ordering': ['round', 'id'],
                'verbose_name': '결재 단계',
                'verbose_name_plural': '결재 단계 목록',
            },
        ),

        # ===== 0006_add_te_p_role =====
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

        # ===== 0007_add_productbarcode =====
        migrations.CreateModel(
            name='ProductBarcode',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('n7mto_date', models.CharField(max_length=200, verbose_name='MTO Date')),
                ('n7c_layer_num', models.CharField(max_length=200, verbose_name='Layer Num')),
                ('n7prod_code', models.CharField(max_length=200, verbose_name='Product Code')),
                ('last_synced', models.DateTimeField(auto_now=True, verbose_name='동기화 시각')),
            ],
            options={
                'verbose_name': '바코드-품목 캐시',
                'verbose_name_plural': '바코드-품목 캐시 목록',
            },
        ),

        # ===== 0008_update_productbarcode =====
        migrations.AlterField(
            model_name='productbarcode',
            name='n7mto_date',
            field=models.CharField(blank=True, max_length=200, null=True, verbose_name='MTO Date'),
        ),
        migrations.AddField(
            model_name='productbarcode',
            name='n7cancel_date',
            field=models.CharField(blank=True, max_length=200, null=True, verbose_name='Cancel Date'),
        ),
        migrations.AddField(
            model_name='productbarcode',
            name='n7barcode',
            field=models.CharField(default='', max_length=200, verbose_name='Barcode'),
            preserve_default=False,
        ),

        # ===== 0009_update_productbarcode =====
        migrations.AddField(
            model_name='productbarcode',
            name='n7cancel_ok',
            field=models.CharField(blank=True, max_length=200, null=True, verbose_name='Cancel OK'),
        ),

        # ===== 0010_requestdocument_production_date =====
        migrations.AddField(
            model_name='requestdocument',
            name='production_date',
            field=models.DateField(blank=True, null=True, verbose_name='실제 생산 진행 날짜'),
        ),

        # ===== 0011_add_holiday_and_approvalstep_due_date =====
        migrations.CreateModel(
            name='Holiday',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('date_name', models.CharField(max_length=100, verbose_name='공휴일명')),
                ('isholiday', models.CharField(max_length=1, verbose_name='공휴일 여부')),
                ('act_date', models.DateField(unique=True, verbose_name='날짜')),
            ],
            options={
                'verbose_name': '공휴일',
                'verbose_name_plural': '공휴일 목록',
            },
        ),
        migrations.AddIndex(
            model_name='holiday',
            index=models.Index(fields=['act_date'], name='api_holiday_act_date_idx'),
        ),
        migrations.AddField(
            model_name='approvalstep',
            name='due_date',
            field=models.DateField(blank=True, null=True, verbose_name='완료 기한'),
        ),

        # ===== 0012_add_guide_model =====
        migrations.CreateModel(
            name='Guide',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('guide_type', models.CharField(
                    choices=[('feature', '기능 가이드'), ('info', '정보 가이드')],
                    default='info', max_length=10, verbose_name='가이드 유형'
                )),
                ('feature_key', models.CharField(
                    blank=True, max_length=100, null=True, unique=True, verbose_name='기능 키'
                )),
                ('title', models.CharField(max_length=200, verbose_name='제목')),
                ('content', models.TextField(verbose_name='내용 (HTML)')),
                ('author_name', models.CharField(max_length=100, verbose_name='작성자 이름')),
                ('author_role', models.CharField(max_length=20, verbose_name='작성자 역할')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='작성일')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='수정일')),
            ],
            options={
                'verbose_name': '가이드',
                'verbose_name_plural': '가이드 목록',
                'ordering': ['-created_at'],
            },
        ),

        # ===== 0013_add_usergroup =====
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

        # ===== 0014_add_mapname =====
        migrations.CreateModel(
            name='MapName',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('lineid', models.CharField(max_length=50, verbose_name='라인 ID')),
                ('partid', models.CharField(max_length=200, verbose_name='Part ID')),
                ('last_synced', models.DateTimeField(auto_now=True, verbose_name='동기화 시각')),
            ],
            options={
                'verbose_name': 'MAP 이름 캐시',
                'verbose_name_plural': 'MAP 이름 캐시 목록',
            },
        ),
        migrations.AddIndex(
            model_name='mapname',
            index=models.Index(fields=['lineid'], name='api_mapname_lineid_idx'),
        ),

        # ===== 0015_peer_review_pl =====
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

        # ===== 0016_add_productbarcode_material_spec =====
        migrations.AddField(
            model_name='productbarcode',
            name='n7material_spec',
            field=models.CharField(blank=True, max_length=500, null=True, verbose_name='Material Spec'),
        ),

        # ===== 0017_add_mailnotification =====
        migrations.CreateModel(
            name='MailNotification',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('event_type', models.CharField(
                    choices=[
                        ('stage_arrival', '단계 도착'),
                        ('rejected', '반려'),
                        ('approved', '승인 완료'),
                    ],
                    max_length=20,
                    verbose_name='이벤트 유형',
                )),
                ('recipients', models.JSONField(default=list, verbose_name='수신자 이메일 목록')),
                ('subject', models.CharField(max_length=500, verbose_name='제목')),
                ('contents', models.TextField(verbose_name='본문(HTML)')),
                ('status', models.CharField(
                    choices=[
                        ('pending', '대기'),
                        ('sent', '발송 완료'),
                        ('failed', '발송 실패'),
                    ],
                    default='pending',
                    max_length=10,
                    verbose_name='상태',
                )),
                ('attempts', models.PositiveSmallIntegerField(default=0, verbose_name='시도 횟수')),
                ('max_attempts', models.PositiveSmallIntegerField(default=5, verbose_name='최대 시도 횟수')),
                ('last_error', models.TextField(blank=True, verbose_name='마지막 에러')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='적재일시')),
                ('sent_at', models.DateTimeField(blank=True, null=True, verbose_name='발송일시')),
                ('document', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='mail_notifications',
                    to='api.requestdocument',
                    verbose_name='의뢰서',
                )),
            ],
            options={
                'verbose_name': '결재 알림 메일',
                'verbose_name_plural': '결재 알림 메일 목록',
                'ordering': ['created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='mailnotification',
            index=models.Index(fields=['status'], name='api_mailnoti_status_idx'),
        ),
    ]
