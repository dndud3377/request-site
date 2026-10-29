// claude 수정 (2026-10-29): MAP 목적 '예정 → 완료' 뱃지 분기 테스트 추가
import React from 'react';
import { render } from '@testing-library/react';
import MapPurposeBadge from './MapPurposeBadge';
import i18n from '../i18n';

describe('MapPurposeBadge', () => {
  it('예정일만 있으면 MM/DD 예정 테두리 뱃지를 보이고, 툴팁에는 연도까지 보인다', () => {
    const { container } = render(<MapPurposeBadge completed={false} scheduledDate="2026-11-03" />);
    const badge = container.querySelector('.badge-mail-scheduled');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe(i18n.t('approval.map_scheduled_badge', { date: '11/03' }));
    expect(badge!.getAttribute('title')).toBe(i18n.t('approval.map_scheduled_badge_tooltip', { date: '2026-11-03' }));
    expect(container.querySelector('.badge-mail-complete')).toBeNull();
  });

  it('완료면 예정일이 있어도 완료 채움 뱃지 하나만 보인다', () => {
    const { container } = render(<MapPurposeBadge completed scheduledDate="2026-11-03" />);
    expect(container.querySelectorAll('.badge')).toHaveLength(1);
    expect(container.querySelector('.badge-mail-complete')!.textContent).toBe(i18n.t('approval.map_mail_complete_badge'));
  });

  it('완료도 예정일도 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<MapPurposeBadge completed={false} scheduledDate={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('예정일 형식이 YYYY-MM-DD 가 아니면 예정 뱃지를 그리지 않는다', () => {
    const { container } = render(<MapPurposeBadge scheduledDate="2026-11-03T09:00:00" />);
    expect(container.firstChild).toBeNull();
  });
});
