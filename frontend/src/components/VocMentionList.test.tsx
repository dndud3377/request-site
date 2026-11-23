/**
 * claude 수정 (2026-11-23): VOC @멘션 추천 목록 — 팀 5개 즉시 표시, 사용자 검색(미지정 계정 제외)·로딩·오류·빈 상태, 키보드 선택.
 *
 * ⚠️ CRA jest 설정은 resetMocks: true 라 jest.fn 구현이 매 테스트마다 지워진다 → 평범한 함수 + mockState 로 쓴다.
 */
import React, { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SuggestionKeyDownProps } from '@tiptap/suggestion';
import type { MentionNodeAttrs } from '@tiptap/extension-mention';
import { VocMentionList, VocMentionListHandle } from './VocMentionList';
import i18n from '../i18n';

const mockState: { queries: string[]; fail: boolean } = { queries: [], fail: false };

jest.mock('../api/client', () => ({
  usersAPI: {
    search: (query: string) => {
      mockState.queries.push(query);
      if (mockState.fail) return Promise.reject(new Error('fail'));
      const users = [
        { id: 1, loginid: 'rkim', name: '김알', deptname: '기술', role: 'TE_R', mail: 'rkim@c.com' },
        { id: 2, loginid: 'rnone', name: '미지정', deptname: '', role: 'NONE', mail: 'rnone@c.com' },
      ];
      return Promise.resolve({ data: users.filter((u) => u.loginid.includes(query)) });
    },
  },
}));

const TEAM_KEYS = ['TE_R', 'TE_P', 'TE_J', 'TE_O', 'TE_E'] as const;
const teamLabel = (role: (typeof TEAM_KEYS)[number]) => `@${i18n.t(`common.role_label_${role}`)}`;

const keyDown = (key: string): SuggestionKeyDownProps =>
  ({ event: new KeyboardEvent('keydown', { key }) } as unknown as SuggestionKeyDownProps);

beforeEach(() => {
  mockState.queries = [];
  mockState.fail = false;
});

describe('VocMentionList', () => {
  it('검색어가 없으면 AGENT 5팀과 안내만 보이고 사용자 검색은 하지 않는다', () => {
    render(<VocMentionList query="" command={() => undefined} />);
    TEAM_KEYS.forEach((role) => expect(screen.getByText(teamLabel(role))).toBeTruthy());
    expect(screen.queryByText(`@${i18n.t('common.role_label_PL')}`)).toBeNull();
    expect(screen.queryByText(`@${i18n.t('common.role_label_MASTER')}`)).toBeNull();
    expect(screen.getByText(i18n.t('voc.mention_hint'))).toBeTruthy();
    expect(mockState.queries).toEqual([]);
  });

  it('검색어로 팀을 거르고, 사용자는 미지정 계정을 빼고 보여 주며 고르면 user:<loginid> 로 넣는다', async () => {
    const picked: MentionNodeAttrs[] = [];
    render(<VocMentionList query="r" command={(attrs) => picked.push(attrs)} />);
    expect(screen.getByText(teamLabel('TE_R'))).toBeTruthy();
    expect(screen.queryByText(teamLabel('TE_P'))).toBeNull();
    expect(screen.getByText(i18n.t('common.loading'))).toBeTruthy();
    await waitFor(() => expect(screen.getByText('@김알')).toBeTruthy());
    expect(screen.queryByText('@미지정')).toBeNull();
    expect(mockState.queries).toEqual(['r']);
    fireEvent.click(screen.getByText('@김알'));
    expect(picked).toEqual([{ id: 'user:rkim', label: '김알' }]);
  });

  it('사용자 검색이 실패하면 오류 문구를 보이고 팀은 그대로 고를 수 있다', async () => {
    mockState.fail = true;
    const picked: MentionNodeAttrs[] = [];
    render(<VocMentionList query="r" command={(attrs) => picked.push(attrs)} />);
    await waitFor(() => expect(screen.getByText(i18n.t('voc.mention_search_error'))).toBeTruthy());
    fireEvent.click(screen.getByText(teamLabel('TE_R')));
    expect(picked).toEqual([{ id: 'team:TE_R', label: i18n.t('common.role_label_TE_R') }]);
  });

  it('일치하는 사용자가 없으면 빈 상태 문구를 보인다', async () => {
    render(<VocMentionList query="zzz" command={() => undefined} />);
    await waitFor(() => expect(screen.getByText(i18n.t('voc.mention_no_user'))).toBeTruthy());
  });

  it('↓ 후 Enter 로 두 번째 팀(P팀)을 고른다', () => {
    const picked: MentionNodeAttrs[] = [];
    const ref = createRef<VocMentionListHandle>();
    render(<VocMentionList ref={ref} query="" command={(attrs) => picked.push(attrs)} />);
    act(() => { ref.current?.onKeyDown(keyDown('ArrowDown')); });
    act(() => { ref.current?.onKeyDown(keyDown('Enter')); });
    expect(picked).toEqual([{ id: 'team:TE_P', label: i18n.t('common.role_label_TE_P') }]);
  });
});
