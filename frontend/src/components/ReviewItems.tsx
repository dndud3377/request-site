import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReviewItem, UserWithRole } from '../types';

/** 단계 상태별 안내 배너 종류 — 어떤 배너를 띄울지는 호출부가 판정해 넘긴다. */
export type ReviewItemsNotice = 'edit' | 'unclaimed' | 'approved' | 'rejected' | null;

export interface ReviewItemsProps {
  items: ReviewItem[];
  /** 항목 추가·제목수정·삭제, 검토자 지정·해제 가능 여부 (백엔드 can_edit_items 와 같은 규칙) */
  canEdit: boolean;
  /** 확인·확인취소 가능 단계인지 (검토자 본인 여부는 항목별로 따로 본다) */
  canConfirm: boolean;
  /** 보고 있는 사용자의 loginid — '나' 표시와 확인 버튼 노출 기준 */
  currentLoginid: string;
  /** 검토자 지정 후보 (J 권한자) */
  candidates: UserWithRole[];
  notice: ReviewItemsNotice;
  /** 'edit' 배너에 표시할 검토중 선점자 이름 */
  claimerName?: string;
  onAdd: (title: string) => void;
  onRename: (itemId: number, title: string) => void;
  onDelete: (itemId: number) => void;
  onAddReviewer: (itemId: number, loginid: string) => void;
  onRemoveReviewer: (itemId: number, loginid: string) => void;
  onConfirm: (itemId: number, confirmed: boolean) => void;
}

/**
 * J-ayer 정보 › 검토 항목.
 *
 * 항목은 마스터 목록의 사본이며, 검토자 지정·확인 상태는 이 의뢰서에만 남는다.
 * 결재 경로(ApprovalStep)와 무관해 결재 현황 목록·결재 경로 탭에는 나타나지 않는다.
 */
export default function ReviewItems({
  items, canEdit, canConfirm, currentLoginid, candidates, notice, claimerName,
  onAdd, onRename, onDelete, onAddReviewer, onRemoveReviewer, onConfirm,
}: ReviewItemsProps): React.ReactElement {
  const { t } = useTranslation();
  const [newTitle, setNewTitle] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [dropdownFor, setDropdownFor] = useState<number | null>(null);

  const submitNew = (): void => {
    const title = newTitle.trim();
    if (!title) return;
    onAdd(title);
    setNewTitle('');
  };

  const startEdit = (item: ReviewItem): void => {
    setEditingId(item.id);
    setEditingTitle(item.title);
  };

  const saveEdit = (item: ReviewItem): void => {
    const title = editingTitle.trim();
    setEditingId(null);
    if (title && title !== item.title) onRename(item.id, title);
  };

  const noticeText = (): string => {
    switch (notice) {
      case 'edit': return t('request.ri_notice_edit', { name: claimerName ?? '' });
      case 'unclaimed': return t('request.ri_notice_unclaimed');
      case 'approved': return t('request.ri_notice_approved');
      case 'rejected': return t('request.ri_notice_rejected');
      default: return '';
    }
  };

  return (
    <div className="ri-pane">
      {notice && (
        <div className={`ri-notice${notice === 'edit' ? ' ri-notice-info' : ' ri-notice-lock'}`}>
          <span>{notice === 'edit' ? '✏️' : '🔒'}</span>
          <span>{noticeText()}</span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="ri-empty">
          {canEdit ? t('request.ri_empty_editable') : t('request.ri_empty')}
        </div>
      ) : (
        <div className="ri-items">
          {items.map((item, idx) => {
            const mine = item.reviewers.find((r) => r.loginid === currentLoginid);
            const assigned = new Set(item.reviewers.map((r) => r.loginid));
            return (
              <div
                key={item.id}
                className={`ri-item${item.is_done ? ' ri-item-done' : ''}${mine && !mine.confirmed && canConfirm ? ' ri-item-mine' : ''}`}
              >
                <div className="ri-item-head">
                  <span className="ri-no">{idx + 1}</span>
                  {editingId === item.id && canEdit ? (
                    <input
                      className="ri-title-input"
                      value={editingTitle}
                      autoFocus
                      maxLength={300}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={() => saveEdit(item)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(item);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                    />
                  ) : (
                    <span className="ri-title">{item.title}</span>
                  )}
                  <span className={`badge ${item.is_done ? 'badge-approved' : 'badge-under_review'}`}>
                    {item.is_done ? t('request.ri_badge_done') : t('request.ri_badge_ing')}
                  </span>
                  {canEdit && (
                    <>
                      <button type="button" className="ri-icon-btn" title={t('request.ri_edit_title')} onClick={() => startEdit(item)}>✏️</button>
                      <button type="button" className="ri-icon-btn ri-icon-danger" title={t('request.ri_delete')} onClick={() => onDelete(item.id)}>🗑</button>
                    </>
                  )}
                </div>

                <div className="ri-rv-row">
                  <span className="ri-rv-label">{t('request.ri_reviewers')}</span>
                  {item.reviewers.length === 0 && !canEdit && (
                    <span className="ri-rv-empty">{t('request.ri_no_reviewer')}</span>
                  )}
                  {item.reviewers.map((r) => (
                    <span
                      key={r.id}
                      className={`ri-chip${r.confirmed ? ' ri-chip-ok' : ''}${r.loginid === currentLoginid ? ' ri-chip-me' : ''}`}
                    >
                      {r.confirmed ? '✓' : '○'} {r.name || r.loginid}
                      {r.loginid === currentLoginid ? ` ${t('request.ri_me_suffix')}` : ''}
                      {canEdit && (r.confirmed ? (
                        <span className="ri-chip-lock" title={t('request.ri_confirmed_lock')}>🔒</span>
                      ) : (
                        <span
                          className="ri-chip-x"
                          title={t('request.ri_remove_reviewer')}
                          onClick={() => onRemoveReviewer(item.id, r.loginid)}
                        >×</span>
                      ))}
                    </span>
                  ))}
                  {canEdit && (
                    <span className="ri-add-rv">
                      <button
                        type="button"
                        className="ri-add-rv-btn"
                        onClick={() => setDropdownFor(dropdownFor === item.id ? null : item.id)}
                      >
                        {t('request.ri_add_reviewer')}
                      </button>
                      {dropdownFor === item.id && (
                        <div className="ri-dropdown">
                          {candidates.length === 0 && (
                            <div className="ri-dd-empty">{t('request.ri_no_candidate')}</div>
                          )}
                          {candidates.map((c) => (
                            <div
                              key={c.loginid}
                              className={`ri-dd-item${assigned.has(c.loginid) ? ' ri-dd-disabled' : ''}`}
                              onClick={() => {
                                if (assigned.has(c.loginid)) return;
                                setDropdownFor(null);
                                onAddReviewer(item.id, c.loginid);
                              }}
                            >
                              <span>
                                {c.name || c.loginid}
                                {assigned.has(c.loginid) ? ` · ${t('request.ri_already_assigned')}` : ''}
                              </span>
                              <span className="ri-dd-mail">{c.mail}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </span>
                  )}
                </div>

                {mine && canConfirm && (
                  <div className="ri-confirm-bar">
                    {mine.confirmed ? (
                      <>
                        <span className="ri-confirm-hint">
                          ✓ {t('request.ri_confirmed_at', { at: (mine.confirmed_at ?? '').replace('T', ' ').slice(0, 16) })}
                        </span>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onConfirm(item.id, false)}>
                          {t('request.ri_confirm_undo')}
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="ri-confirm-hint">{t('request.ri_mine')}</span>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => onConfirm(item.id, true)}>
                          {t('request.ri_confirm')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canEdit && (
        <div className="ri-add-item">
          <input
            className="ri-add-input"
            value={newTitle}
            maxLength={300}
            placeholder={t('request.ri_add_placeholder')}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitNew(); }}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={submitNew}>
            {t('request.ri_add')}
          </button>
        </div>
      )}
    </div>
  );
}
