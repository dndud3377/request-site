/**
 * claude 수정 (2026-11-10): 결재 상세 MAP 정보 탭 '숫자 확인 필수' 사진 카드 테스트 신설
 *
 * '해당 있음'(detail.num_check)이거나 사진이 있으면 카드에 해당 여부·숫자 확인 값·사진을 보여주고, 해당 없음이면 카드가 없다.
 */
import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
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
  it('해당 있음 + 사진이면 카드에 해당 여부·숫자·모든 사진이 보인다', () => {
    render(<Harness doc={makeDoc({
      num_check: '해당 있음', num_check_value: '12.5', num_check_images: ['mshot_images/a.png', 'mshot_images/b.png'],
    })} />);
    expect(screen.getByText(TITLE)).toBeDefined();
    expect(screen.getByText(i18n.t('request.num_check_applies'))).toBeDefined();
    expect(screen.getByText('12.5')).toBeDefined();
    expect(screen.getByText(i18n.t('request.num_check_image_no', { no: 1 }))).toBeDefined();
    expect(screen.getByText(i18n.t('request.num_check_image_no', { no: 2 }))).toBeDefined();
    expect(screen.getByAltText('num-check-1').getAttribute('src')).toBe('/media/mshot_images/a.png');
    expect(screen.getByAltText('num-check-2').getAttribute('src')).toBe('/media/mshot_images/b.png');
    // 한 줄에 2장(2열 그리드), 사진 크기가 달라도 같은 크기 칸(폭 100% × 높이 320px)에 비율을 유지한 채 맞춘다
    const img = screen.getByAltText('num-check-1') as HTMLImageElement;
    expect([img.style.width, img.style.height, img.style.objectFit]).toEqual(['100%', '320px', 'contain']);
    const grid = img.parentElement?.parentElement?.parentElement as HTMLElement;
    expect(grid.style.display).toBe('grid');
    expect(grid.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
  });

  it('해당 있음이고 숫자가 기준값 미만이라 사진이 없어도 카드에 해당 여부·숫자가 보인다', () => {
    render(<Harness doc={makeDoc({ num_check: '해당 있음', num_check_value: '3', num_check_images: [] })} />);
    // 카드(제목 칩의 바깥 박스) 안에서만 찾는다 — 화면 다른 곳(탭 번호 등)에도 '3' 이 있다.
    const card = screen.getByText(TITLE).closest('div')?.parentElement?.parentElement as HTMLElement;
    expect(within(card).getByText('3')).toBeDefined();
    expect(within(card).getByText(i18n.t('request.num_check_applies'))).toBeDefined();
    expect(screen.queryByAltText('num-check-1')).toBeNull();
  });

  it('해당 없음이거나 필드가 없는 옛 문서는 카드가 없다', () => {
    const { unmount } = render(<Harness doc={makeDoc({ num_check: '해당 없음', num_check_value: '', num_check_images: [] })} />);
    expect(screen.queryByText(TITLE)).toBeNull();
    unmount();
    render(<Harness doc={makeDoc({})} />);
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});
