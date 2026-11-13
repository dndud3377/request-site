// claude 수정 (2026-11-13): 결재 현황·이력 상세 모달의 '전체 export' 버튼을 공용 컴포넌트로 — 규칙 J(오류·진행 중 처리)와 일부 캡처 실패 경고
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from './Toast';
import type { PagedDetailViewHandle } from './PagedDetailView';
import { exportAll, ExportAllColorFilters, ExportAllScreenshots } from '../utils/detailExport';
import type { RequestDocument } from '../types';

/** 상세 보기 핸들이 없을 때(모달이 막 닫히는 중 등) 쓰는 캡처 결과 — 전부 실패로 본다. */
const NO_SCREENSHOTS: ExportAllScreenshots = { detail: null, map: null, etc: null, route: null };

interface ExportAllButtonProps {
  doc: RequestDocument;
  /** 상세 정보·MAP 정보·기타·결재 경로 탭을 캡처하는 PagedDetailView 핸들 */
  pagedDetailViewRef: React.RefObject<PagedDetailViewHandle>;
  /** J/O 색상 필터(결재 현황만 넘긴다 — 이력 화면에는 색상 필터가 없다) */
  colorFilters?: ExportAllColorFilters;
}

/**
 * 상세 모달 제목 옆 '📊 전체 export' 버튼.
 * - 생성 중에는 버튼을 비활성화하고 '생성 중…'을 보여주며, 연타해도 한 번만 실행한다.
 * - 캡처·엑셀 생성이 실패하면 오류 토스트를 띄운다.
 * - 파일은 만들었지만 캡처 시트 중 실패한 것이 있으면 경고 토스트를 띄운다.
 */
const ExportAllButton: React.FC<ExportAllButtonProps> = ({ doc, pagedDetailViewRef, colorFilters }) => {
  const { t } = useTranslation();
  const addToast = useToast();
  const [exporting, setExporting] = useState(false);
  // state 는 다음 렌더에 반영되므로, 같은 틱 안의 연타는 ref 로 막는다.
  const runningRef = useRef(false);

  const handleClick = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setExporting(true);
    try {
      const screenshots = (await pagedDetailViewRef.current?.captureAllScreenshots()) ?? NO_SCREENSHOTS;
      await exportAll(doc, t, screenshots, colorFilters);
      if (Object.values(screenshots).some((shot) => shot === null)) {
        addToast(t('request.export_capture_partial_failed'), 'warning');
      }
    } catch {
      addToast(t('request.export_all_error'), 'error');
    } finally {
      runningRef.current = false;
      setExporting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={exporting}
      className="btn btn-secondary btn-sm"
      style={{ fontSize: '0.75rem', padding: '2px 10px' }}
    >
      📊 {exporting ? t('request.export_all_generating') : t('request.export_all_btn')}
    </button>
  );
};

export default ExportAllButton;
