import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addressBooksAPI, usersAPI } from '../api/client';
import { useToast } from '../components/Toast';
import { ConfirmModal } from '../components/Modal';
import { AddressBook, AddressBookMember, UserWithRole } from '../types';

export default function AddressBookPage(): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();

  const [books, setBooks] = useState<AddressBook[]>([]);
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [renameValue, setRenameValue] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [memberDropdownOpen, setMemberDropdownOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AddressBook | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

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
        const [, uRes] = await Promise.all([fetchBooks(), usersAPI.list()]);
        if (cancelled) return;
        setUsers(uRes.data);
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

  // 바깥 클릭 시 멤버 검색 드롭다운 닫기
  useEffect(() => {
    if (!memberDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setMemberDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [memberDropdownOpen]);

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

  const handleAddMember = async (u: UserWithRole) => {
    if (!selected) return;
    if (selected.members.some((m) => m.loginid === u.loginid)) return;
    const members = [...toRefs(selected.members), { loginid: u.loginid, name: u.name }];
    setMemberQuery('');
    setMemberDropdownOpen(false);
    try {
      await addressBooksAPI.update(selected.id, { members });
      await fetchBooks(selected.id);
      addToast(t('addressbook.member_added'), 'success');
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

  const memberMatches = useMemo(() => {
    if (!selected) return [];
    const q = memberQuery.trim().toLowerCase();
    const chosen = new Set(selected.members.map((m) => m.loginid));
    return users
      .filter((u) => !chosen.has(u.loginid))
      .filter((u) =>
        !q ||
        u.name.toLowerCase().includes(q) ||
        u.loginid.toLowerCase().includes(q) ||
        (u.mail ?? '').toLowerCase().includes(q) ||
        (u.deptname ?? '').toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [users, selected, memberQuery]);

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

                {/* 멤버 추가 검색 */}
                <div ref={searchRef} style={{ position: 'relative', marginBottom: 14 }}>
                  <input
                    className="form-control"
                    placeholder={t('addressbook.add_member_placeholder')}
                    value={memberQuery}
                    onChange={(e) => { setMemberQuery(e.target.value); setMemberDropdownOpen(true); }}
                    onFocus={() => setMemberDropdownOpen(true)}
                    autoComplete="off"
                  />
                  {memberDropdownOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginTop: 2, maxHeight: 240, overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
                      {memberMatches.length === 0 ? (
                        <div style={{ padding: '8px 12px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          {t('request.search_no_result')}
                        </div>
                      ) : memberMatches.map((u) => (
                        <div
                          key={u.loginid}
                          onMouseDown={(e) => { e.preventDefault(); handleAddMember(u); }}
                          style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid var(--border)' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                        >
                          <span style={{ fontWeight: 600 }}>{u.name}</span>
                          <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.75rem' }}>
                            {u.loginid}{u.mail ? ` · ${u.mail}` : ''}{u.deptname ? ` · ${u.deptname}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
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
                          <th>{t('addressbook.col_dept')}</th>
                          <th>{t('addressbook.col_mail')}</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.members.map((m) => (
                          <tr key={m.loginid}>
                            <td style={{ fontWeight: 500 }}>{m.name}</td>
                            <td>{m.loginid}</td>
                            <td>{userDept(users, m.loginid)}</td>
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
    </div>
  );
}

function userDept(users: UserWithRole[], loginid: string): string {
  const u = users.find((x) => x.loginid === loginid);
  return u?.deptname ?? '-';
}
