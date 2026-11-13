/**
 * claude 수정 (2026-11-13): 전체 export 캡처 핸들(captureAllScreenshots)이 결재 경로 탭까지 캡처하는지 검증한다.
 * html2canvas 를 가로채 어떤 DOM 노드를 캡처했는지 기록하고, 캡처 후 원래 탭으로 돌아오는지 확인한다.
 */
import React, { createRef, useState } from 'react';
import { render, act } from '@testing-library/react';
import html2canvas from 'html2canvas';
import PagedDetailView, { PagedDetailViewHandle } from './PagedDetailView';
import { RequestDocument } from '../types';
import { ExportAllScreenshots } from '../utils/detailExport';

jest.mock('html2canvas', () => jest.fn());

const ROUTE_TAB_SELECTOR = '[data-tour="approval-route-tab"]';
const START_PAGE_IDX = 2;

const doc = {
  id: 1, title: 'capture-doc', requester_name: '이의뢰', requester_email: 'req@company.com',
  requester_department: 'dept', product_name: 'PROD-1', reference_materials: '',
  additional_notes: JSON.stringify({ detail: { request_purpose: '신규', map_type: 'NEW', only_prodc: 'No' }, history: [] }),
  status: 'under_review', production_date: null, created_at: '2026-11-13T00:00:00Z',
  updated_at: '2026-11-13T00:00:00Z', submitted_at: '2026-11-13T00:00:00Z', approval_steps: [],
} as unknown as RequestDocument;

let currentPageIdx = -1;

const Harness = React.forwardRef<PagedDetailViewHandle>((_, ref) => {
  const [pageIdx, setPageIdx] = useState(START_PAGE_IDX);
  currentPageIdx = pageIdx;
  return <PagedDetailView ref={ref} doc={doc} role="MASTER" pageIdx={pageIdx} setPageIdx={setPageIdx} />;
});
Harness.displayName = 'Harness';

describe('전체 export 캡처 — 결재 경로 탭', () => {
  it('결재 경로 탭을 캡처하고 원래 탭으로 돌아온다', async () => {
    const capturedRouteTab: boolean[] = [];
    (html2canvas as jest.Mock).mockImplementation(async (el: HTMLElement) => {
      capturedRouteTab.push(el.matches(ROUTE_TAB_SELECTOR));
      // 캡처 결과 blob 이 null 이면 captureNode 는 null 을 돌려준다 — 어떤 노드를 캡처했는지만 본다.
      return { width: 1, height: 1, toBlob: (cb: (b: Blob | null) => void) => cb(null) };
    });
    const ref = createRef<PagedDetailViewHandle>();
    render(<Harness ref={ref} />);

    let shots: ExportAllScreenshots | undefined;
    await act(async () => { shots = await ref.current?.captureAllScreenshots(); });

    expect(capturedRouteTab).toContain(true);
    expect(capturedRouteTab[capturedRouteTab.length - 1]).toBe(true);
    expect(shots).toHaveProperty('route');
    expect(currentPageIdx).toBe(START_PAGE_IDX);
  });
});
