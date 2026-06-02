# ⚠️ MASKING 처리된 파일. 이 파일에 포함된 비즈니스 용어는 {{ko.json}} 키로 마스킹되어 있습니다. 원래 용어를 확인하려면 다음 파일을 참조하세요: frontend/src/locales/ko.json

from django.utils import timezone
from django.http import JsonResponse, StreamingHttpResponse
from django.views.decorators.http import require_GET, require_POST
from django.views.decorators.csrf import csrf_exempt
import queue as _queue_module
from .sse import broadcaster
from django.db import connections
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action, api_view
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, BasePermission, SAFE_METHODS
from django_filters.rest_framework import DjangoFilterBackend
from django.db import connection
from django.contrib.auth import get_user_model
User = get_user_model()
from django.db.models import Q
from .models import (
    RequestDocument, ApprovalStep, VOC, VocComment, Line, ProcessProduct, ProductProcessId, AdminNotice,
    PhotoStepS1, PhotoStepS3, PhotoStepS4, PhotoStepS5, VocHistory, ProductBarcode,
)
from .serializers import (
    RequestDocumentSerializer, RequestDocumentListSerializer,
    VOCSerializer, VocCommentSerializer, LineSerializer, AdminNoticeSerializer, VocHistorySerializer,
    UserSerializer,
)
import uuid
import logging
import re


class IsMasterOrReadOnly(BasePermission):
    """읽기는 모두 허용, 쓰기는 MASTER 역할만 허용"""

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return (
            request.user.is_authenticated and
            request.user.role == 'MASTER'
        )


class RequestDocumentViewSet(viewsets.ModelViewSet):
    queryset = RequestDocument.objects.all()
    permission_classes = [AllowAny]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status', 'product_name']
    search_fields = ['title', 'product_name', 'requester_name', 'requester_department']
    ordering_fields = ['created_at', 'submitted_at']
    ordering = ['-created_at']

    def get_serializer_class(self):
        if self.action == 'list':
            return RequestDocumentListSerializer
        return RequestDocumentSerializer

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        """상신: draft → under_review, {{approval.agent_R}} 단계 생성"""
        document = self.get_object()
        if document.status != 'draft':
            return Response(
                {'error': '임시저장 상태의 의뢰서만 상신할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # 원본 데이터 목록 매핑 검증: 모든 J-ayer 행에 bb 이 매핑되어야 함
        import json
        try:
            detail = json.loads(document.additional_notes or '{}')
            jayer_rows = detail.get('jayerRows', [])
            bb_rows = detail.get('bbRows', [])

            # 매핑된 J-ayer 행 ID 집합
            mapped_jayer_ids = set()
            for bb_row in bb_rows:
                source_id = bb_row.get('sourceJayerRowId')
                if source_id:
                    mapped_jayer_ids.add(source_id)

            # process_id가 있는 J-ayer 행 중 매핑되지 않은 행 확인
            unmapped_rows = [
                row for row in jayer_rows
                if row.get('process_id') and row.get('id') not in mapped_jayer_ids
            ]

            if unmapped_rows:
                return Response(
                    {'error': '모든 원본 데이터에 bb 을 매핑해야 상신할 수 있습니다.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        except (json.JSONDecodeError, TypeError):
            pass  # JSON 파싱 실패 시 검증 스킵

        document.status = 'under_review'
        document.submitted_at = document.submitted_at or timezone.now()
        document.save()

        ApprovalStep.objects.filter(document=document).delete()
        ApprovalStep.objects.create(document=document, agent='R', action='pending', round=1)

        return Response({
            'message': '의뢰서가 성공적으로 상신되었습니다.',
            'email_sent': False,
            'document': RequestDocumentSerializer(document).data,
        })

    @action(detail=True, methods=['post'])
    def resubmit(self, request, pk=None):
        """재상신: rejected → under_review, 단계 초기화 후 {{approval.agent_R}}부터"""
        document = self.get_object()
        if document.status != 'rejected':
            return Response(
                {'error': '반려된 의뢰서만 재상신할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # 원본 데이터 목록 매핑 검증: 모든 J-ayer 행에 bb 이 매핑되어야 함
        import json
        try:
            detail = json.loads(document.additional_notes or '{}')
            jayer_rows = detail.get('jayerRows', [])
            bb_rows = detail.get('bbRows', [])

            # 매핑된 J-ayer 행 ID 집합
            mapped_jayer_ids = set()
            for bb_row in bb_rows:
                source_id = bb_row.get('sourceJayerRowId')
                if source_id:
                    mapped_jayer_ids.add(source_id)

            # process_id가 있는 J-ayer 행 중 매핑되지 않은 행 확인
            unmapped_rows = [
                row for row in jayer_rows
                if row.get('process_id') and row.get('id') not in mapped_jayer_ids
            ]

            if unmapped_rows:
                return Response(
                    {'error': '모든 원본 데이터에 bb 을 매핑해야 상신할 수 있습니다.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        except (json.JSONDecodeError, TypeError):
            pass  # JSON 파싱 실패 시 검증 스킵

        document.status = 'under_review'
        document.save()

        from django.db.models import Max
        max_round = ApprovalStep.objects.filter(document=document).aggregate(Max('round'))['round__max'] or 0
        ApprovalStep.objects.create(document=document, agent='R', action='pending', round=max_round + 1)

        return Response({
            'message': '재상신되었습니다.',
            'document': RequestDocumentSerializer(document).data,
        })

    @action(detail=True, methods=['post'])
    def withdraw(self, request, pk=None):
        """철회: under_review/rejected → draft, 단계 초기화"""
        document = self.get_object()
        if document.status not in ('under_review', 'rejected', 'submitted'):
            return Response(
                {'error': '철회할 수 없는 상태입니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        document.status = 'draft'
        document.submitted_at = None
        document.save()

        ApprovalStep.objects.filter(document=document).delete()

        return Response({'message': '철회되었습니다.'})

    @action(detail=True, methods=['post'], url_path='delete')
    def delete(self, request, pk=None):
        """의뢰서 삭제 (모든 상태 가능)"""
        document = self.get_object()
        document.delete()
        return Response({'message': '삭제되었습니다.'})

    @action(detail=True, methods=['post'], url_path='approve-step')
    def approve_step(self, request, pk=None):
        """에이전트 단계 합의 (mock.ts mockApproveStep 로직과 동일)"""
        document = self.get_object()
        agent = request.data.get('agent')
        comment = request.data.get('comment', '')

        if agent not in ('R', 'P', 'J', 'O', 'E'):
            return Response({'error': '유효하지 않은 에이전트입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        from django.db.models import Max
        max_round = ApprovalStep.objects.filter(document=document).aggregate(Max('round'))['round__max'] or 1

        step = ApprovalStep.objects.filter(
            document=document, agent=agent, action='pending', round=max_round
        ).first()
        if not step:
            return Response({'error': f'AGENT {agent}의 대기 중인 단계가 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        step.action = 'approved'
        step.acted_at = timezone.now()
        step.comment = comment
        step.save()

        new_status = document.status
        current_round = step.round

        if agent == 'R':
            # R 합의 → P 단계 생성
            ApprovalStep.objects.create(document=document, agent='P', action='pending', round=current_round)
            new_status = 'under_review'

        elif agent == 'P':
            # P 합의 → J, O, [E if PLEL] 병렬 단계 생성
            ApprovalStep.objects.create(document=document, agent='J', action='pending', is_parallel=True, round=current_round)
            ApprovalStep.objects.create(document=document, agent='O', action='pending', is_parallel=True, round=current_round)
            if document.has_ppid_plel():
                ApprovalStep.objects.create(document=document, agent='E', action='pending', is_parallel=True, round=current_round)
            new_status = 'under_review'

        elif agent in ('J', 'O', 'E'):
            # J/O/[E] 모두 합의 시 최종 승인
            j_step = ApprovalStep.objects.filter(document=document, agent='J', round=current_round).order_by('-id').first()
            o_step = ApprovalStep.objects.filter(document=document, agent='O', round=current_round).order_by('-id').first()
            e_step = ApprovalStep.objects.filter(document=document, agent='E', round=current_round).order_by('-id').first()
            j_approved = j_step and j_step.action == 'approved'
            o_approved = o_step and o_step.action == 'approved'
            if e_step:
                all_approved = j_approved and o_approved and e_step.action == 'approved'
            else:
                all_approved = j_approved and o_approved
            if all_approved:
                new_status = 'approved'

        document.status = new_status
        document.save()

        return Response({
            'message': '처리되었습니다.',
            'status': new_status,
        })

    @action(detail=True, methods=['post'], url_path='reject-step')
    def reject_step(self, request, pk=None):
        """에이전트 단계 반려"""
        document = self.get_object()
        agent = request.data.get('agent')
        comment = request.data.get('comment', '')

        if agent not in ('R', 'P', 'J', 'O', 'E'):
            return Response({'error': '유효하지 않은 에이전트입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        from django.db.models import Max
        max_round = ApprovalStep.objects.filter(document=document).aggregate(Max('round'))['round__max'] or 1

        step = ApprovalStep.objects.filter(
            document=document, agent=agent, action='pending', round=max_round
        ).first()
        if not step:
            return Response({'error': f'AGENT {agent}의 대기 중인 단계가 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        step.action = 'rejected'
        step.acted_at = timezone.now()
        step.comment = comment
        step.save()

        document.status = 'rejected'
        document.save()

        return Response({'message': '반려되었습니다.', 'status': 'rejected'})

    @action(detail=True, methods=['post'], url_path='assign-step')
    def assign_step(self, request, pk=None):
        """에이전트 단계 담당자 지정"""
        document = self.get_object()
        agent = request.data.get('agent')
        assignee_loginid = request.data.get('assignee_loginid')
        assignee_name = request.data.get('assignee_name', '')

        from django.db.models import Max
        max_round = ApprovalStep.objects.filter(document=document).aggregate(Max('round'))['round__max'] or 1

        step = ApprovalStep.objects.filter(
            document=document, agent=agent, action='pending', round=max_round
        ).first()
        if not step:
            return Response({'error': '해당 단계를 찾을 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        if assignee_loginid:
            try:
                assignee_user = User.objects.get(loginid=assignee_loginid)
                step.assignee = assignee_user
            except User.DoesNotExist:
                return Response({'error': '사용자를 찾을 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        step.assignee_name = assignee_name
        step.save()

        return Response({'message': '담당자가 지정되었습니다.'})

    def _unique_title(self, base_title, exclude_id=None):
        """중복 제목 처리: 같은 제목이 있으면 _2, _3, ... suffix 를 붙여 반환"""
        qs = RequestDocument.objects.all()
        if exclude_id is not None:
            qs = qs.exclude(id=exclude_id)

        if not qs.filter(title=base_title).exists():
            return base_title

        pattern = re.compile(r'^' + re.escape(base_title) + r'_(\d+)$')
        existing_numbers = []
        for title in qs.filter(title__startswith=base_title + '_').values_list('title', flat=True):
            m = pattern.match(title)
            if m:
                existing_numbers.append(int(m.group(1)))

        next_num = max(existing_numbers) + 1 if existing_numbers else 2
        return f"{base_title}_{next_num}"

    def perform_create(self, serializer):
        base_title = serializer.validated_data.get('title', '')
        serializer.save(title=self._unique_title(base_title))

    def perform_update(self, serializer):
        base_title = serializer.validated_data.get('title', serializer.instance.title)
        serializer.save(title=self._unique_title(base_title, exclude_id=serializer.instance.id))

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """상태별 통계"""
        total = RequestDocument.objects.count()
        by_status = {}
        for key, _ in RequestDocument.STATUS_CHOICES:
            by_status[key] = RequestDocument.objects.filter(status=key).count()

        return Response({'total': total, 'by_status': by_status})


class VOCViewSet(viewsets.ModelViewSet):
    queryset = VOC.objects.all()
    serializer_class = VOCSerializer
    permission_classes = [AllowAny]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['category', 'status', 'submitter_user_id']
    search_fields = ['title', 'submitter_name', 'content']
    ordering = ['-created_at']

    @action(detail=True, methods=['post'])
    def comment(self, request, pk=None):
        voc = self.get_object()
        data = {**request.data, 'voc': voc.id}
        serializer = VocCommentSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(VOCSerializer(voc).data)


class LineViewSet(viewsets.ReadOnlyModelViewSet):
    """{{request.line}} 마스터 데이터 (읽기 전용)"""
    queryset = Line.objects.filter(is_active=True)
    serializer_class = LineSerializer
    permission_classes = [AllowAny]
    pagination_class = None


class AdminNoticeViewSet(viewsets.ModelViewSet):
    """공지사항 (읽기: 모두, 쓰기: MASTER 전용)"""
    queryset = AdminNotice.objects.all()
    serializer_class = AdminNoticeSerializer
    permission_classes = [IsMasterOrReadOnly]
    pagination_class = None
    filter_backends = []

    @action(detail=False, methods=['get'])
    def latest(self, request):
        """최신 공지 1개 반환"""
        notice = AdminNotice.objects.first()
        if not notice:
            return Response(None)
        return Response(AdminNoticeSerializer(notice).data)

@require_GET
def health_check(request):
    """헬스체크 엔드포인트 - DB 연결 상태 확인"""
    try:
        conn = connections['default']
        conn.cursor()
        return JsonResponse({'status': 'healthy', 'db': 'connected'})
    except Exception as e:
        return JsonResponse({'status': 'unhealthy', 'db': 'disconnected', 'error': str(e)}, status=503)


@require_GET
def form_options_process(request):
    """{{request.line}} → {{request.process_selection}} 목록"""
    import logging
    logger = logging.getLogger(__name__)
    from .models import ProcessProduct as CP
    line = request.GET.get('line', '')
    logger.warning(f"[DEBUG] line parameter: {repr(line)}")
    if not line:
        logger.warning("[DEBUG] line is empty, returning empty options")
        return JsonResponse({'options': []})
    # Debug: 총 레코드 수 확인
    total = CP.objects.count()
    line_count = CP.objects.filter(line=line).count()
    logger.warning(f"[DEBUG] total records: {total}, line '{line}' count: {line_count}")
    options = list(
        CP.objects
        .filter(line=line)
        .values_list('process', flat=True)
        .distinct()
        .order_by('process')
    )
    logger.warning(f"[DEBUG] options count: {len(options)}")
    return JsonResponse({'options': options})


@require_GET
def form_options_products(request):
    """{{request.line}} + {{request.process_selection}} → {{request.partid_selection}} 목록 (process 은 선택 사항)"""
    line = request.GET.get('line', '')
    process = request.GET.get('process', None)  # None 으로 설정하여 파라미터 유무 확인
    if not line:
        return JsonResponse({'options': []})
    
    # process 파라미터가 있으면 필터링, 없으면 {{request.line}} 에 해당하는 모든 제품 반환
    queryset = ProcessProduct.objects.filter(line=line)
    if process is not None and process != '':
        queryset = queryset.filter(process=process)
    
    options = list(
        queryset
        .values_list('product_name', flat=True)
        .distinct()
        .order_by('product_name')
    )
    return JsonResponse({'options': options})

@require_GET
def form_options_process_id(request):
    """{{request.line}} + {{request.partid_selection}} → {{request.process_id}} 목록"""
    line = request.GET.get('line', '')
    product = request.GET.get('product', '')
    if not line or not product:
        return JsonResponse({'options': []})
    options = list(
        ProductProcessId.objects
        .filter(line=line, product_name=product)
        .values_list('process_id', flat=True)
        .distinct()
        .order_by('process_id')
    )
    return JsonResponse({'options': options})


@require_GET
def form_options_job_file_layer(request):
    """{{request.line}} + {{request.process_id}} → JOB FILE layer 정보 (eqptype='PMAINF')"""
    import logging
    logger = logging.getLogger(__name__)
    
    line = request.GET.get('line', '')
    process = request.GET.get('process', '')
    
    if not line or not process:
        return JsonResponse({'options': []})
    
    # {{request.line}} 별 모델 매핑
    model_map = {
        'line1': PhotoStepS1,
        'line3': PhotoStepS3,
        'line4': PhotoStepS4,
        'line5': PhotoStepS5,
    }

    model = model_map.get(line)
    if not model:
        logger.warning(f"[JOB_FILE_LAYER] 알 수 없는 {{request.line}}: {line}")
        return JsonResponse({'options': []})
    
    try:
        # eqptype='PMAINF' AND processid='{process}' 조건으로 조회
        # stepseq 오름차순 정렬
        queryset = model.objects.filter(
            eqptype='PMAINF',
            processid=process
        ).order_by('stepseq')
        
        options = []
        for item in queryset:
            options.append({
                'line': line,
                'process': process,
                'processid': item.processid,
                'stepseq': item.stepseq,
                'descript': item.descript,
                'recipeid': item.recipeid,
                'layerid': item.layerid or '',
                'updated': item.updated or '',
            })
        
        logger.info(f"[JOB_FILE_LAYER] {len(options)}건 조회 성공: {line}, {process}")
        return JsonResponse({'options': options})
        
    except Exception as e:
        logger.error(f"[JOB_FILE_LAYER] 조회 실패: {e}")
        return JsonResponse({'options': [], 'error': str(e)})


@require_GET
def form_options_ovl_layer(request):
    """{{request.line}} + {{request.process_id}} → OVL layer 정보 (eqptype='POVLAY')"""
    import logging
    logger = logging.getLogger(__name__)
    
    line = request.GET.get('line', '')
    process = request.GET.get('process', '')
    
    if not line or not process:
        return JsonResponse({'options': []})
    
    # {{request.line}} 별 모델 매핑
    model_map = {
        'line1': PhotoStepS1,
        'line3': PhotoStepS3,
        'line4': PhotoStepS4,
        'line5': PhotoStepS5,
    }
    
    model = model_map.get(line)
    if not model:
        logger.warning(f"[OVL_LAYER] 알 수 없는 {{request.line}}: {line}")
        return JsonResponse({'options': []})
    
    try:
        # eqptype='POVLAY' AND processid='{process}' 조건으로 조회
        # stepseq 오름차순 정렬
        queryset = model.objects.filter(
            eqptype='POVLAY',
            processid=process
        ).order_by('stepseq')
        
        options = []
        for item in queryset:
            options.append({
                'line': line,
                'process': process,
                'processid': item.processid,
                'stepseq': item.stepseq,
                'descript': item.descript,
                'recipeid': item.recipeid,
                'layerid': item.layerid or '',
                'updated': item.updated or '',
            })
        
        logger.info(f"[OVL_LAYER] {len(options)}건 조회 성공: {line}, {process}")
        return JsonResponse({'options': options})
        
    except Exception as e:
        logger.error(f"[OVL_LAYER] 조회 실패: {e}")
        return JsonResponse({'options': [], 'error': str(e)})


@csrf_exempt
@require_POST
def upload_image(request):
    """이미지 파일 업로드 API - mshot 이미지용"""
    logger = logging.getLogger(__name__)
    
    if 'image' not in request.FILES:
        return JsonResponse({'error': '이미지 파일이 없습니다'}, status=400)
    
    image = request.FILES['image']
    
    # 이미지 파일 검증
    if not image.content_type.startswith('image/'):
        return JsonResponse({'error': '이미지 파일만 업로드할 수 있습니다'}, status=400)
    
    # 파일 크기 제한 (2MB)
    max_size = 2 * 1024 * 1024  # 2MB
    if image.size > max_size:
        return JsonResponse({'error': '이미지 크기는 2MB 를 초과할 수 없습니다'}, status=400)
    
    # 파일명 생성 (UUID 사용)
    ext = image.name.split('.')[-1] if '.' in image.name else 'png'
    filename = f"mshot_{uuid.uuid4().hex}.{ext}"
    path = f"mshot_images/{filename}"
    
    try:
        # 파일 저장
        saved_path = default_storage.save(path, ContentFile(image.read()))
        file_url = default_storage.url(saved_path)
        
        logger.info(f"[UPLOAD_IMAGE] 이미지 업로드 성공: {saved_path}")
        
        return JsonResponse({
            'path': saved_path,
            'url': file_url,
            'original_name': image.name,
            'size': image.size
        })
    except Exception as e:
        logger.error(f"[UPLOAD_IMAGE] 이미지 업로드 실패: {e}")
        return JsonResponse({'error': f'업로드 실패: {str(e)}'}, status=500)




class VocHistoryViewSet(viewsets.ModelViewSet):
    """VOC 처리 이력"""
    queryset = VocHistory.objects.all()
    serializer_class = VocHistorySerializer
    permission_classes = [AllowAny]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['voc', 'action']
    ordering = ['-acted_at']

    @action(detail=False, methods=['get'])
    def by_voc(self, request):
        """특정 VOC 의 이력 목록 조회"""
        voc_id = request.query_params.get('voc_id')
        if not voc_id:
            return Response({'error': 'voc_id 가 필요합니다'}, status=status.HTTP_400_BAD_REQUEST)
        
        histories = VocHistory.objects.filter(voc_id=voc_id).order_by('acted_at')
        serializer = self.get_serializer(histories, many=True)
        return Response(serializer.data)


@require_GET
def form_options_bb_external(request):
    """bb 외부 데이터 - {{request.line}} + {{request.process_id}} → api_steps (eqptype='PMAINF')"""
    import logging
    logger = logging.getLogger(__name__)
    
    line = request.GET.get('location', '')
    product = request.GET.get('product', '')  # {{request.partid_selection}} (현재는 사용 안 함)
    process_id = request.GET.get('process_id', '')  # {{request.process_id}}
    
    if not line or not process_id:
        logger.warning(f"[BB_EXTERNAL] {{request.line}} 또는 {{request.process_id}} 누락: line={line}, process_id={process_id}")
        return JsonResponse({'options': []})
    
    # {{request.line}} 별 모델 매핑
    model_map = {
        'line1': PhotoStepS1,
        'line3': PhotoStepS3,
        'line4': PhotoStepS4,
        'line5': PhotoStepS5,
    }
    
    model = model_map.get(line)
    if not model:
        logger.warning(f"[BB_EXTERNAL] 알 수 없는 {{request.line}}: {line}")
        return JsonResponse({'options': []})
    
    try:
        # eqptype='PMAINF' AND processid='{process_id}' 조건으로 조회
        # stepseq 오름차순 정렬
        queryset = model.objects.filter(
            eqptype='PMAINF',
            processid=process_id
        ).order_by('stepseq')
        
        options = []
        for item in queryset:
            options.append({
                'processid': item.processid,
                'stepseq': item.stepseq,
                'descript': item.descript,
                'layerid': item.layerid or '',
            })
        
        logger.info(f"[BB_EXTERNAL] {len(options)}건 조회 성공: {line}, {process_id}")
        return JsonResponse({'options': options})

    except Exception as e:
        logger.error(f"[BB_EXTERNAL] 조회 실패: {e}")
        return JsonResponse({'options': [], 'error': str(e)})


@require_GET
def form_options_layer_ids(request):
    """line + process → unique sorted layerid list (eqptype='PMAINF')"""
    line = request.GET.get('line', '')
    process = request.GET.get('process', '')

    if not line or not process:
        return JsonResponse({'options': []})

    model_map = {
        'line1': PhotoStepS1,
        'line3': PhotoStepS3,
        'line4': PhotoStepS4,
        'line5': PhotoStepS5,
    }

    model = model_map.get(line)
    if not model:
        return JsonResponse({'options': []})

    try:
        layerids = (
            model.objects.filter(eqptype='PMAINF', processid=process)
            .exclude(layerid='').exclude(layerid=None)
            .values_list('layerid', flat=True)
            .distinct()
            .order_by('layerid')
        )
        return JsonResponse({'options': list(layerids)})
    except Exception as e:
        return JsonResponse({'options': []})


@require_GET
def form_options_barcode(request):
    """product_name → 유효한 바코드 옵션 목록 반환 (n7cancel_date, n7cancel_ok 없는 행만)"""
    product_name = request.GET.get('product_name', '')
    if not product_name:
        return JsonResponse({'options': []})

    try:
        qs = ProductBarcode.objects.filter(
            n7prod_code=product_name,
        ).filter(
            Q(n7cancel_date__isnull=True) | Q(n7cancel_date='')
        ).filter(
            Q(n7cancel_ok__isnull=True) | Q(n7cancel_ok='')
        )

        options = [
            {
                'label': f"{row.n7barcode} [{row.n7mto_date}]" if row.n7mto_date else row.n7barcode,
                'n7c_layer_num': row.n7c_layer_num,
            }
            for row in qs
        ]
        return JsonResponse({'options': options})
    except Exception as e:
        return JsonResponse({'options': []})


class UserViewSet(viewsets.ModelViewSet):
    """
    사용자 관리 ViewSet
    - list: 모든 사용자 목록 조회
    - create: login_id 로 사용자 생성 및 권한 부여
    - destroy: 사용자 삭제
    - for-assignment: 권한 부여 대상 사용자 목록 (role='NONE')
    - assign-role: 사용자에게 역할 부여
    """
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [AllowAny]  # 테스트 서버용
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['loginid', 'username', 'deptname']
    ordering_fields = ['id', 'loginid']
    ordering = ['id']

    def get_serializer_class(self):
        return UserSerializer

    def get_queryset(self):
        role = self.request.query_params.get('role')
        if role:
            return User.objects.filter(role=role)
        return User.objects.all()

    @action(detail=False, methods=['get'], url_path='for-assignment')
    def for_assignment(self, request):
        """권한 부여 대상 사용자 목록 (role='NONE' 인 사용자)"""
        users = User.objects.filter(role='NONE').order_by('loginid')
        data = [{
            'id': u.id,
            'username': u.loginid,
            'display_name': u.username,
            'department': u.deptname,
            'email': u.mail,
        } for u in users]
        return Response(data)

    @action(detail=True, methods=['post'], url_path='assign-role')
    def assign_role(self, request, pk=None):
        """사용자에게 역할 부여"""
        user = self.get_object()
        role = request.data.get('role')

        if role not in ['PL', 'TE_R', 'TE_P', 'TE_J', 'TE_O', 'TE_E', 'MASTER']:
            return Response({'error': '유효하지 않은 역할입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        User.objects.filter(pk=user.pk).update(role=role)
        user.refresh_from_db()

        broadcaster.broadcast('user_updated', {
            'id': user.id,
            'loginid': user.loginid,
            'name': user.username or '',
            'deptname': user.deptname or '',
            'role': role,
            'mail': user.mail or '',
        })

        return Response({
            'id': user.id,
            'username': user.loginid,
            'role': role,
        })
    
    def create(self, request, *args, **kwargs):
        # login_id 를 context 로 전달
        loginid = request.data.get('loginid')
        if not loginid:
            return Response(
                {'loginid': 'loginid is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        serializer = self.get_serializer(data=request.data, context={'loginid': loginid})
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    
    def perform_create(self, serializer):
        serializer.save()
    
    def destroy(self, request, *args, **kwargs):
        try:
            user = self.get_object()
            user_id = user.id
            user.delete()
            broadcaster.broadcast('user_deleted', {'id': user_id})
            return Response(status=status.HTTP_204_NO_CONTENT)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )


@csrf_exempt
def user_events(request):
    """SSE endpoint: 사용자 권한 변경 실시간 스트림"""
    def event_stream():
        q = broadcaster.subscribe()
        try:
            yield ": connected\n\n"
            while True:
                try:
                    msg = q.get(timeout=30)
                    yield msg
                except _queue_module.Empty:
                    yield ": keepalive\n\n"
        finally:
            broadcaster.unsubscribe(q)

    response = StreamingHttpResponse(event_stream(), content_type='text/event-stream')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'
    return response
