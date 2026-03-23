from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('auth', '0012_alter_user_first_name_max_length'),
    ]

    operations = [
        migrations.CreateModel(
            name='Line',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=50, unique=True, verbose_name='라인 이름')),
                ('order', models.PositiveSmallIntegerField(default=0, verbose_name='정렬 순서')),
                ('is_active', models.BooleanField(default=True, verbose_name='활성 여부')),
            ],
            options={
                'verbose_name': '라인',
                'verbose_name_plural': '라인 목록',
                'ordering': ['order', 'name'],
            },
        ),
        migrations.CreateModel(
            name='VOC',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=200, verbose_name='제목')),
                ('category', models.CharField(choices=[('inquiry', '문의'), ('complaint', '불만'), ('suggestion', '제안'), ('praise', '칭찬')], max_length=20, verbose_name='유형')),
                ('submitter_name', models.CharField(max_length=100, verbose_name='제출자')),
                ('submitter_email', models.EmailField(max_length=254, verbose_name='이메일')),
                ('content', models.TextField(verbose_name='내용')),
                ('response', models.TextField(blank=True, verbose_name='답변')),
                ('status', models.CharField(choices=[('open', '접수'), ('in_progress', '처리중'), ('resolved', '해결됨'), ('closed', '종료')], default='open', max_length=20, verbose_name='상태')),
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
            name='RequestDocument',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=300, verbose_name='의뢰서 제목')),
                ('requester_name', models.CharField(max_length=100, verbose_name='의뢰자 이름')),
                ('requester_email', models.EmailField(max_length=254, verbose_name='의뢰자 이메일')),
                ('requester_department', models.CharField(max_length=100, verbose_name='부서')),
                ('product_name', models.CharField(max_length=200, verbose_name='제품명')),
                ('reference_materials', models.TextField(blank=True, verbose_name='참고 자료')),
                ('additional_notes', models.TextField(blank=True, verbose_name='추가 정보(JSON)')),
                ('status', models.CharField(choices=[('draft', '임시저장'), ('submitted', '상신됨'), ('under_review', '검토중'), ('approved', '승인됨'), ('rejected', '반려됨'), ('revision_required', '수정요청')], default='draft', max_length=20, verbose_name='상태')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='생성일')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='수정일')),
                ('submitted_at', models.DateTimeField(blank=True, null=True, verbose_name='상신일')),
                ('requester', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='requests', to='auth.user', verbose_name='의뢰자')),
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
                ('agent', models.CharField(choices=[('R', 'AGENT R'), ('J', 'AGENT J'), ('O', 'AGENT O'), ('E', 'AGENT E')], max_length=2, verbose_name='담당 에이전트')),
                ('action', models.CharField(choices=[('pending', '대기'), ('approved', '합의'), ('rejected', '반려')], default='pending', max_length=10, verbose_name='결재 결과')),
                ('acted_at', models.DateTimeField(blank=True, null=True, verbose_name='처리일시')),
                ('comment', models.TextField(blank=True, verbose_name='의견')),
                ('is_parallel', models.BooleanField(default=False, verbose_name='병렬 처리 여부')),
                ('assignee_name', models.CharField(blank=True, max_length=100, verbose_name='담당자 이름')),
                ('document', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='approval_steps', to='api.requestdocument', verbose_name='의뢰서')),
                ('assignee', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='assigned_steps', to='auth.user', verbose_name='담당자')),
            ],
            options={
                'verbose_name': '결재 단계',
                'verbose_name_plural': '결재 단계 목록',
                'ordering': ['id'],
            },
        ),
        migrations.CreateModel(
            name='UserProfile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('role', models.CharField(choices=[('PL', '제품 담당자'), ('TE_R', 'AGENT R팀'), ('TE_J', 'AGENT J팀'), ('TE_O', 'AGENT O팀'), ('TE_E', 'AGENT E팀'), ('MASTER', '관리자')], max_length=10)),
                ('department', models.CharField(blank=True, max_length=100)),
                ('display_name', models.CharField(blank=True, max_length=100)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='profile', to='auth.user')),
            ],
        ),
    ]
