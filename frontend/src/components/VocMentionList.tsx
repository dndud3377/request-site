// claude 수정 (2026-11-23): VOC @멘션 추천 목록 — '@' 입력 시 AGENT 5팀과 사용자 검색 결과를 보여 준다.
// 고른 항목은 멘션 노드(data-id=team:TE_R / user:<loginid>)로 본문에 들어가고, 서버가 그 표식으로
// 태그 대상을 확정해 메일·팀 탭·내 VOC 에 반영한다(backend VOCViewSet._extract_voc_mentions).
import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactRenderer } from '@tiptap/react';
import type { MentionNodeAttrs, MentionOptions } from '@tiptap/extension-mention';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { usersAPI } from '../api/client';
import { UserRole, UserWithRole, VocMentionItem } from '../types';

// 태그할 수 있는 팀 — AGENT 5팀(백엔드 VocMention.TEAM_ROLES 와 같은 목록·순서). 제품 담당자·관리자는 제외.
// 라벨은 권한 라벨(common.role_label_*)을 그대로 쓴다.
const VOC_MENTION_TEAMS = [
  { role: 'TE_R', labelKey: 'common.role_label_TE_R' },
  { role: 'TE_P', labelKey: 'common.role_label_TE_P' },
  { role: 'TE_J', labelKey: 'common.role_label_TE_J' },
  { role: 'TE_O', labelKey: 'common.role_label_TE_O' },
  { role: 'TE_E', labelKey: 'common.role_label_TE_E' },
] as const;
// 멘션 표식 접두어 — 백엔드 VOC_MENTION_TEAM_PREFIX / VOC_MENTION_USER_PREFIX 와 같아야 한다.
export const VOC_MENTION_TEAM_PREFIX = 'team:';
export const VOC_MENTION_USER_PREFIX = 'user:';
// 권한이 부여되지 않은 계정은 태그 대상이 아니다(서버도 같은 기준으로 거른다).
const UNASSIGNED_ROLE: UserRole = 'NONE';
// 사용자 검색 결과 최대 표시 수, 입력 후 검색까지 기다리는 시간(ms)
const USER_RESULT_LIMIT = 8;
const USER_SEARCH_DELAY_MS = 200;
// 추천 목록 팝업 — 커서 아래 간격(px), 모달(z-index 2000) 위에 뜨도록 하는 z-index
const POPUP_OFFSET_PX = 4;
const POPUP_Z_INDEX = 2500;

export interface VocMentionListProps {
  query: string;
  command: (attrs: MentionNodeAttrs) => void;
}

export interface VocMentionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

type UserSearchState = 'idle' | 'loading' | 'error' | 'done';

const toUserItem = (user: UserWithRole): VocMentionItem => ({
  id: `${VOC_MENTION_USER_PREFIX}${user.loginid}`,
  label: user.name || user.loginid,
  kind: 'user',
  detail: [user.loginid, user.deptname].filter(Boolean).join(' · '),
});

/** '@' 추천 목록. 팀은 즉시 거르고, 사용자는 검색어가 있을 때만 서버에서 찾는다. */
export const VocMentionList = forwardRef<VocMentionListHandle, VocMentionListProps>(({ query, command }, ref) => {
  const { t } = useTranslation();
  const [users, setUsers] = useState<VocMentionItem[]>([]);
  const [userState, setUserState] = useState<UserSearchState>('idle');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const keyword = query.trim().toLowerCase();
  const teams: VocMentionItem[] = VOC_MENTION_TEAMS
    .map(({ role, labelKey }): VocMentionItem => ({
      id: `${VOC_MENTION_TEAM_PREFIX}${role}`,
      label: t(labelKey),
      kind: 'team',
      detail: '',
    }))
    .filter((item) => !keyword || item.label.toLowerCase().includes(keyword));
  const items = [...teams, ...users];

  useEffect(() => {
    setSelectedIndex(0);
    if (!keyword) {
      setUsers([]);
      setUserState('idle');
      return undefined;
    }
    let cancelled = false;
    setUserState('loading');
    const timer = window.setTimeout(async () => {
      try {
        const res = await usersAPI.search(keyword);
        if (cancelled) return;
        setUsers(
          res.data
            .filter((user) => user.role !== UNASSIGNED_ROLE && !!user.loginid)
            .slice(0, USER_RESULT_LIMIT)
            .map(toUserItem),
        );
        setUserState('done');
      } catch {
        if (cancelled) return;
        setUsers([]);
        setUserState('error');
      }
    }, USER_SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keyword]);

  const selectItem = (index: number) => {
    const item = items[index];
    if (item) command({ id: item.id, label: item.label });
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false;
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  const renderItem = (item: VocMentionItem, index: number) => (
    <button
      key={item.id}
      type="button"
      className={`voc-mention-item ${index === selectedIndex ? 'active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => selectItem(index)}
      onMouseEnter={() => setSelectedIndex(index)}
    >
      <span className="voc-mention-item-label">@{item.label}</span>
      {item.detail && <span className="voc-mention-item-detail">{item.detail}</span>}
    </button>
  );

  return (
    <div className="voc-mention-list" role="listbox">
      {teams.length > 0 && <div className="voc-mention-group">{t('voc.mention_group_team')}</div>}
      {teams.map((item, index) => renderItem(item, index))}
      {keyword && <div className="voc-mention-group">{t('voc.mention_group_user')}</div>}
      {userState === 'loading' && <div className="voc-mention-status">{t('common.loading')}</div>}
      {userState === 'error' && <div className="voc-mention-status error">{t('voc.mention_search_error')}</div>}
      {userState === 'done' && users.length === 0 && (
        <div className="voc-mention-status">{t('voc.mention_no_user')}</div>
      )}
      {users.map((item, index) => renderItem(item, teams.length + index))}
      {!keyword && <div className="voc-mention-status">{t('voc.mention_hint')}</div>}
    </div>
  );
});

VocMentionList.displayName = 'VocMentionList';

/** 추천 목록을 커서(멘션 입력 위치) 바로 아래에 띄운다. */
const placePopup = (element: HTMLElement, clientRect?: (() => DOMRect | null) | null) => {
  const rect = clientRect?.();
  if (!rect) return;
  element.style.position = 'fixed';
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.bottom + POPUP_OFFSET_PX}px`;
  element.style.zIndex = String(POPUP_Z_INDEX);
};

/** VOC 에디터(등록 본문·답글)용 '@' 멘션 추천 설정 — RichTextEditor 의 mentionSuggestion 으로 넘긴다. */
export const vocMentionSuggestion: MentionOptions<VocMentionItem>['suggestion'] = {
  // 목록은 VocMentionList 가 query 로 직접 만든다(사용자 검색의 로딩·오류·빈 상태를 화면에서 처리하기 위해).
  items: () => [],
  render: () => {
    let renderer: ReactRenderer<VocMentionListHandle, VocMentionListProps> | null = null;
    return {
      onStart: (props: SuggestionProps<VocMentionItem, MentionNodeAttrs>) => {
        renderer = new ReactRenderer(VocMentionList, {
          editor: props.editor,
          props: { query: props.query, command: props.command },
        });
        document.body.appendChild(renderer.element);
        placePopup(renderer.element, props.clientRect);
      },
      onUpdate: (props: SuggestionProps<VocMentionItem, MentionNodeAttrs>) => {
        if (!renderer) return;
        renderer.updateProps({ query: props.query, command: props.command });
        placePopup(renderer.element, props.clientRect);
      },
      // Escape 는 suggestion 플러그인이 직접 닫는다(onExit 호출).
      onKeyDown: (props: SuggestionKeyDownProps) => renderer?.ref?.onKeyDown(props) ?? false,
      onExit: () => {
        renderer?.destroy();
        renderer?.element.remove();
        renderer = null;
      },
    };
  },
};
