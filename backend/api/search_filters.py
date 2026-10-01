"""의뢰서 목록 검색 필터 — ADI CD 변경 '동일 변경 적용 대상' 전체를 검색 대상에 넣는다.

기존 DRF `SearchFilter` 는 `search_fields`(제목·제품명·의뢰자·부서)만 검색한다. 그런데 의뢰서의
`product_name` 에는 첫 대상의 제품 이름만 저장되고, 제목에도 첫 대상과 `(+N)` 만 들어가므로
2번째 이후 대상의 제품 이름/조리법으로는 검색되지 않았다.

이 필터는 검색어마다 기존 필드 조건에 'ADI CD 대상 일치' 조건을 OR 로 더한다(검색어끼리는 기존처럼 AND).
스키마 변경이 없고 `additional_notes` 를 쓰는 모든 경로와 항상 동기화된다 — 별도 검색용 컬럼을 두지 않는다.
"""
import json
import operator
from functools import reduce

from django.db import models
from rest_framework import filters

from .models import RequestDocument


class AdiCdTargetSearchFilter(filters.SearchFilter):
    """`SearchFilter` + ADI CD 변경 문서의 모든 대상(제품 이름·조리법) 부분 일치 검색(대소문자 무시)."""

    def filter_queryset(self, request, queryset, view):
        search_fields = self.get_search_fields(view, request)
        search_terms = self.get_search_terms(request)

        if not search_fields or not search_terms:
            return queryset

        orm_lookups = [
            self.construct_search(str(search_field), queryset)
            for search_field in search_fields
        ]

        base = queryset
        # ADI CD 문서의 대상 목록은 요청당 한 번만 읽고, 검색어마다 메모리에서 비교한다.
        candidates = self._adi_cd_candidates(base)
        conditions = []
        for term in search_terms:
            condition = reduce(
                operator.or_,
                (models.Q(**{orm_lookup: term}) for orm_lookup in orm_lookups),
            )
            matched_ids = self._matched_ids(candidates, term)
            if matched_ids:
                condition |= models.Q(pk__in=matched_ids)
            conditions.append(condition)
        queryset = queryset.filter(reduce(operator.and_, conditions))

        # DRF SearchFilter 와 같은 중복 제거 처리
        if self.must_call_distinct(queryset, search_fields):
            queryset = queryset.filter(pk=models.OuterRef('pk'))
            queryset = base.filter(models.Exists(queryset))
        return queryset

    @staticmethod
    def _adi_cd_candidates(queryset):
        """`[(pk, [(제품 이름, 조리법), ...])]` — 요청 목적이 ADI CD 변경인 문서만.

        DB 에서는 제목에 'ADI CD 변경' 이 든 문서로만 좁힌다(ADI CD 문서는 J/O-layer 표가 비어
        additional_notes 가 작다). 이후 JSON 의 request_purpose 로 한 번 더 확인하므로 제목만 닮은
        문서는 걸러진다. JSON 이 깨진 문서는 `[]` 로 보고 건너뛴다(`get_detail` 과 같은 규약).
        values_list 에는 prefetch 를 못 쓰므로 `prefetch_related(None)` 으로 비운다.
        """
        rows = (
            queryset.prefetch_related(None)
            .filter(title__icontains=RequestDocument.ADI_CD_CHANGE_PURPOSE)
            .order_by()
            .values_list('pk', 'additional_notes')
        )
        candidates = []
        for pk, notes in rows:
            try:
                detail = (json.loads(notes or '{}') or {}).get('detail')
            except (json.JSONDecodeError, TypeError, AttributeError):
                continue
            targets = RequestDocument.adi_cd_targets_from_detail(detail)
            if targets:
                candidates.append((pk, [
                    (t['partid_selection'].lower(), t['process_id'].lower()) for t in targets
                ]))
        return candidates

    @staticmethod
    def _matched_ids(candidates, term):
        """검색어가 어느 대상의 제품 이름 또는 조리법에 들어 있는 문서 pk 목록."""
        needle = term.lower()
        return [
            pk for pk, targets in candidates
            if any(needle in partid or needle in process_id for partid, process_id in targets)
        ]
