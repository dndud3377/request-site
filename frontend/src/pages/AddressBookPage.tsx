import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addressBooksAPI } from '../api/client';
import { useToast } from '../components/Toast';
import Modal, { ConfirmModal } from '../components/Modal';
import { AddressBook, AddressBookAddMembersResult, AddressBookMember } from '../types';

// loginid 입력창에서 타이핑/붙여넣기 즉시 허용하는 문자(영문/숫자/./,/@) — '@'는 이메일 붙여넣기 편의용.
const LOGINID_INPUT_ALLOWED_CHARS = /[^A-Za-z0-9.,@]/g;
// Enter 입력 시 콤마로 분리된 각 조각에서 '@' 이후(도메인)를 제외하고 남은 값의 최종 정제 문자.
const LOGINID_TOKEN_SANITIZE = /[^A-Za-z0-9.]/g;

export default function AddressBookPage(): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();

  const [books, setBooks] = useState<AddressBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [renameValue, setRenameValue] = useState('');
  const [loginidInput, setLoginidInput] = useState('');
  const [addResult, setAddResult] = useState<AddressBookAddMembersResult | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AddressBook | null>(null);

  const selected = useMemo(
    () => books.find((b) => b.id === selectedId) ?? null,
    [books, selectedId]
  );

  const fetchBooks = useCallback(async (keepId?: number | null): Promise<AddressBook[]> => {
    const list = await addressBooksAPI.list();
    setBooks(list);
    setSelectedId((prev) => {
      const target = keepId !== undefined ? keepId : prev;
      if (target != null && list.some((b) => b.id === target)) return target;
      return list.length > 0 ? list[0].id : null;
    });
    return list;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        await fetchBooks();
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchBooks]);

  useEffect(() => {
    setRenameValue(selected?.name ?? '');
  }, [selected?.id, selected?.name]);

  const toRefs = (members: AddressBookMember[]) =>
    members.map((m) => ({ loginid: m.loginid, name: m.name }));

  const handleCreate = async () => {
    try {
      const created = await addressBooksAPI.create(t('addressbook.new_default_name'), []);
      await fetchBooks(created.id);
      addToast(t('addressbook.created'), 'success');
    } catch {
      addToast(t('common.process_error'), 'error');
    }
  };

  const handleRename = async () => {
    if (!selected) return;
    const name = renameValue.trim();
    if (!name || name === selected.name) {
      setRenameValue(selected.name);
      return;
    }
    try {
      await addressBooksAPI.update(selected.id, { name });
      await fetchBooks(selected.id);
      addToast(t('addressbook.renamed'), 'success');
    } catch {
      addToast(t('common.process_error'), 'error');
      setRenameValue(selected.name);
    }
  };

  const handleLoginidInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLoginidInput(e.target.value.replace(LOGINID_INPUT_ALLOWED_CHARS, ''));
  };

  const handleLoginidKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !selected) return;
    e.preventDefault();

    const existing = new Set(selected.members.map((m) => m.loginid));
    const candidates = Array.from(new Set(
      loginidInput
        .split(',')
        .map((raw) => raw.trim())
        .map((raw) => (raw.includes('@') ? raw.slice(0, raw.indexOf('@')) : raw))
        .map((raw) => raw.replace(LOGINID_TOKEN_SANITIZE, ''))
        .filter((lid) => lid.length > 0 && !existing.has(lid))
    ));

    setLoginidInput('');
    if (candidates.length === 0) return;

    try {
      const result = await addressBooksAPI.addMembers(selected.id, candidates);
      setBooks((prev) => prev.map((b) => (b.id === result.book.id ? result.book : b)));
      setAddResult(result);
    } catch {
      addToast(t('common.process_error'), 'error');
    }
  };

  const handleRemoveMember = async (loginid: string) => {
    if (!selected) return;
    const members = toRefs(selected.members).filter((m) => m.loginid !== loginid);
    try {
      await addressBooksAPI.update(selected.id, { members });
      await fetchBooks(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    try {
      await addressBooksAPI.delete(id);
      setDeleteTarget(null);
      await fetchBooks(null);
      addToast(t('addressbook.deleted'), 'success');
    } catch {
      addToast(t('common.process_error'), 'error');
    }
  };

  return (
    <div className="container page">
      <div style={{ marginBottom: 20 }}>
        <h1 className="section-title">{t('addressbook.page_title')}</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0' }}>
          {t('addressbook.page_subtitle')}
        </p>
      </div>

      {loading ? (
        <div className="empty-state"><p>{t('common.loading')}</p></div>
      ) : error ? (
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <p>{t('common.load_error')}</p>
          <button className="btn" onClick={() => fetchBooks()}>{t('common.retry')}</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' }}>
          {/* 좌: 주소록 목록 */}
          <div className="card" style={{ padding: 10 }}>
            <button className="btn btn-primary btn-sm" style={{ width: '100%', marginBottom: 8 }} onClick={handleCreate}>
              + {t('addressbook.new')}
            </button>
            {books.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '8px 6px' }}>
                {t('addressbook.empty_page')}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {books.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setSelectedId(b.id)}
                    style={{
                      textAlign: 'left', border: '1px solid transparent', borderRadius: 'var(--radius-sm)',
                      padding: '9px 11px', cursor: 'pointer',
                      background: b.id === selectedId ? 'var(--bg-secondary)' : 'transparent',
                      borderColor: b.id === selectedId ? 'var(--border)' : 'transparent',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{b.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      {t('addressbook.member_count', { count: b.member_count })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 우: 선택된 주소록 편집 */}
          <div className="card" style={{ padding: 18 }}>
            {!selected ? (
              <div className="empty-state"><p>{t('addressbook.select_hint')}</p></div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <input
                    className="form-control"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={handleRename}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    aria-label={t('addressbook.rename')}
                    style={{ fontSize: '1rem', fontWeight: 700, maxWidth: 320 }}
                  />
                  <span style={{ flex: 1 }} />
                  <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(selected)}>
                    🗑 {t('addressbook.delete_book')}
                  </button>
                </div>

                {/* loginid 입력으로 구성원 추가 */}
                <div style={{ marginBottom: 14 }}>
                  <input
                    className="form-control"
                    placeholder={t('addressbook.add_member_placeholder')}
                    value={loginidInput}
                    onChange={handleLoginidInputChange}
                    onKeyDown={handleLoginidKeyDown}
                    autoComplete="off"
                  />
                </div>

                {/* 멤버 표 */}
                {selected.members.length === 0 ? (
                  <div className="empty-state" style={{ padding: '30px 10px' }}>
                    <p>{t('addressbook.no_members')}</p>
                  </div>
                ) : (
                  <div className="table-wrapper">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{t('addressbook.col_name')}</th>
                          <th>{t('addressbook.col_id')}</th>
                          <th>{t('addressbook.col_mail')}</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.members.map((m) => (
                          <tr key={m.loginid}>
                            <td style={{ fontWeight: 500 }}>{m.name}</td>
                            <td>{m.loginid}</td>
                            <td>
                              {m.has_mail ? m.mail : (
                                <span className="badge badge-unassigned">{t('addressbook.no_mail_badge')}</span>
                              )}
                            </td>
                            <td>
                              <button className="btn btn-secondary btn-sm" onClick={() => handleRemoveMember(m.loginid)}>
                                {t('common.delete')}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 12 }}>
                  {t('addressbook.owner_me')}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('common.confirm')}
        message={t('addressbook.delete_confirm', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('common.delete')}
        danger
      />

      <Modal
        isOpen={!!addResult}
        onClose={() => setAddResult(null)}
        title={t('addressbook.add_result_title')}
        size="sm"
        hideFullscreen
        style={{ maxWidth: '420px' }}
        footer={
          <button className="btn btn-primary" onClick={() => setAddResult(null)}>
            {t('common.confirm')}
          </button>
        }
      >
        {addResult && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {addResult.added.length > 0 && (
              <div>
                <p style={{ fontWeight: 600, marginBottom: 6 }}>
                  {t('addressbook.add_result_added', { count: addResult.added.length })}
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.85rem' }}>
                  {addResult.added.map((m) => (
                    <li key={m.loginid}>{m.loginid} — {m.name}</li>
                  ))}
                </ul>
              </div>
            )}
            {addResult.not_found.length > 0 && (
              <div>
                <p style={{ fontWeight: 600, marginBottom: 6, color: 'var(--danger)' }}>
                  {t('addressbook.add_result_not_found', { count: addResult.not_found.length })}
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.85rem' }}>
                  {addResult.not_found.map((lid) => (
                    <li key={lid}>{lid}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
