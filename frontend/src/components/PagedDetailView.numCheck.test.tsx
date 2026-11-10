/**
 * claude 수정 (2026-11-10): 결재 상세 MAP 정보 탭 '숫자 확인 필수' 사진 카드 테스트 신설
 *
 * 사진(detail.num_check_images)이 1장 이상이면 카드에 사진 순번과 이미지가 모두 보이고, 없으면 카드가 없다.
 */
import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import PagedDetailView from './PagedDetailView';
import i18n from '../i18n';
import { RequestDocument } from '../types';

const MAP_TAB_IDX = 1;
const TITLE = i18n.t('request.num_check_title');

const makeDoc = (detail: Record<string, unknown>): RequestDocument => ({
  id: 1,
  title: 'num-check-doc',
  requester_name: '이의뢰',
  requester_email: 'req@company.com',
  requester_department: 'dept',
  product_name: 'PROD-1',
  reference_materials: '',
  additional_notes: JSON.stringify({
    detail: { request_purpose: '신규', map_type: 'NEW', map_change: '변경 없음', only_prodc: 'No', ...detail },
    history: [],
  }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-10T00:00:00Z',
  submitted_at: '2026-11-10T00:00:00Z',
  approval_steps: [],
} as RequestDocument);

const Harness: React.FC<{ doc: RequestDocument }> = ({ doc }) => {
  const [pageIdx, setPageIdx] = useState(MAP_TAB_IDX);
  return <PagedDetailView doc={doc} role="PL" pageIdx={pageIdx} setPageIdx={setPageIdx} />;
};

describe('MAP 정보 탭 — 숫자 확인 필수 사진', () => {
  it('사진이 있으면 카드에 모든 사진이 순번과 함께 보인다', () => {
    render(<Harness doc={makeDoc({ num_check_images: ['mshot_images/a.png', 'mshot_images/b.png'] })} />);
    expect(screen.getByText(TITLE)).toBeDefined();
    expect(screen.getByText(i18n.t('request.num_check_image_no', { no: 1 }))).toBeDefined();
    expect(screen.getByText(i18n.t('request.num_check_image_no', { no: 2 }))).toBeDefined();
    expect(screen.getByAltText('num-check-1').getAttribute('src')).toBe('/media/mshot_images/a.png');
    expect(screen.getByAltText('num-check-2').getAttribute('src')).toBe('/media/mshot_images/b.png');
  });

  it('사진이 없거나 필드가 없는 옛 문서는 카드가 없다', () => {
    const { unmount } = render(<Harness doc={makeDoc({ num_check_images: [] })} />);
    expect(screen.queryByText(TITLE)).toBeNull();
    unmount();
    render(<Harness doc={makeDoc({})} />);
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});
