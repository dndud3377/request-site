import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { usersAPI } from '../api/client';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import { UserRole, UserWithRole, UserForAssignment } from '../types';

const ALL_ROLES: UserRole[] = ['PL', 'TE_R', 'TE_J', 'TE_O', 'TE_E', 'MASTER', 'NONE'];




// ===== User Table =====

interface UserTableProps {
  users: UserWithRole[];
  canModify: boolean;
  onRequestDelete: (user: UserWithRole) => void;
  deletingId: number | null;
}

function UserTable({
  users,
  canModify,
  onRequestDelete,
  deletingId,
}: UserTableProps): React.ReactElement {
  const { t } = useTranslation();

  if (users.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
        {t('permission.no_users')}
      </div>
    );
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid var(--color-border, #e2e8f0)' }}>
          <th style={thStyle}>{t('permission.field_loginid')}</th>
          <th style={thStyle}>{t('permission.field_name')}</th>
          <th style={thStyle}>{t('permission.field_email')}</th>
          <th style={thStyle}>{t('permission.field_department')}</th>
          {canModify && <th style={{ ...thStyle, width: 80 }}></th>}
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id} style={{ borderBottom: '1px solid var(--color-border, #e2e8f0)' }}>
            <td style={tdStyle}>{user.loginid}</td>
            <td style={tdStyle}>{user.name || '-'}</td>
            <td style={tdStyle}>{user.mail || '-'}</td>
            <td style={tdStyle}>{user.deptname || '-'}</td>
            {canModify && (
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                <button
                  className="btn btn-danger"
                  style={{ padding: '3px 12px', fontSize: 12 }}
                  onClick={() => onRequestDelete(user)}
                  disabled={deletingId === user.id}
                >
                  {deletingId === user.id ? '...' : t('permission.delete')}
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontWeight: 600,
  fontSize: 13,
  color: '#4a5568',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 14,
};

// ===== Main Page =====

export default function PermissionPage(): React.ReactElement {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const addToast = useToast();

  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<UserRole>(() =>
    currentUser.role === 'MASTER' ? 'PL' : (currentUser.role || 'NONE')
  );
  const [usersForAssignment, setUsersForAssignment] = useState<UserForAssignment[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<UserForAssignment[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserWithRole | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [tabSearchQuery, setTabSearchQuery] = useState('');

  const isMaster = currentUser.role === 'MASTER';

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchUsers = useCallback(() => {
    setLoading(true);
    usersAPI
      .list()
      .then((r) => setUsers(r.data))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, []);

  const fetchUsersForAssignment = useCallback(() => {
    usersAPI
      .forAssignment()
      .then((r) => setUsersForAssignment(r.data))
      .catch(() => setUsersForAssignment([]));
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchUsersForAssignment();
  }, [fetchUsers, fetchUsersForAssignment]);

  useEffect(() => {
    const es = new EventSource('/api/users/events/');

    es.addEventListener('user_added', (e: MessageEvent) => {
      const user = JSON.parse(e.data) as UserWithRole;
      setUsers(prev => prev.some(u => u.id === user.id) ? prev : [...prev, user]);
      if (user.role === 'NONE') {
        setUsersForAssignment(prev => {
          if (prev.some(u => u.id === user.id)) return prev;
          return [...prev, {
            id: user.id,
            username: user.loginid,
            display_name: user.name,
            department: user.deptname,
            email: user.mail,
          }];
        });
      }
    });

    es.addEventListener('user_updated', (e: MessageEvent) => {
      const updated = JSON.parse(e.data) as UserWithRole;
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
      setUsersForAssignment(prev => prev.filter(u => u.id !== updated.id));
    });

    es.addEventListener('user_deleted', (e: MessageEvent) => {
      const { id } = JSON.parse(e.data) as { id: number };
      setUsers(prev => prev.filter(u => u.id !== id));
      setUsersForAssignment(prev => prev.filter(u => u.id !== id));
    });

    return () => es.close();
  }, []);

  const usersForTab = users.filter((u) => {
    if (u.role !== activeTab) return false;
    if (!tabSearchQuery.trim()) return true;
    const q = tabSearchQuery.toLowerCase();
    return (
      (u.loginid && u.loginid.toLowerCase().includes(q)) ||
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.mail && u.mail.toLowerCase().includes(q)) ||
      (u.deptname && u.deptname.toLowerCase().includes(q))
    );
  });

  const canModifyTab = isMaster || currentUser.role === activeTab;

  const filteredUsers = usersForAssignment.filter((u) => {
    if (selectedUsers.some((s) => s.id === u.id)) return false;
    if (!userSearchQuery.trim()) return false;
    const q = userSearchQuery.toLowerCase();
    return (
      u.display_name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.department && u.department.toLowerCase().includes(q))
    );
  });

  const handleSelectUser = (user: UserForAssignment) => {
    if (selectedUsers.some((s) => s.id === user.id)) return;
    setSelectedUsers((prev) => [...prev, user]);
    setUserSearchQuery('');
    setSearchDropdownOpen(false);
  };

  const handleRemoveUser = (userId: number) => {
    setSelectedUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUsers.length === 0) {
      addToast(t('permission.select_user_error'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      const results = await Promise.allSettled(
        selectedUsers.map((user) => usersAPI.assignRole(user.id, activeTab))
      );
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      if (succeeded > 0) {
        fetchUsers();
        fetchUsersForAssignment();
      }

      if (failed === 0) {
        addToast(t('permission.add_success'), 'success');
        setFormOpen(false);
      } else if (succeeded > 0) {
        const failedUsers = selectedUsers.filter((_, i) => results[i].status === 'rejected');
        setSelectedUsers(failedUsers);
        addToast(t('permission.add_partial_success', { succeeded, failed }), 'error');
      } else {
        addToast(t('permission.add_error'), 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    try {
      await usersAPI.remove(deleteTarget.id);
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
      addToast(t('permission.delete_success'), 'success');
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : t('permission.delete_error'), 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="container" style={{ padding: '32px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          {t('permission.title')}
        </h1>
        <p style={{ color: '#718096', fontSize: 14 }}>
          {t('permission.subtitle')}
        </p>
      </div>

      {/* Role Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid var(--color-border, #e2e8f0)', paddingBottom: 0 }}>
        {ALL_ROLES.map((role) => (
          <button
            key={role}
            onClick={() => { setActiveTab(role); setTabSearchQuery(''); }}
            style={{
              padding: '8px 18px',
              fontSize: 14,
              fontWeight: activeTab === role ? 700 : 400,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              borderBottom: activeTab === role ? '2px solid var(--color-primary, #3182ce)' : '2px solid transparent',
              color: activeTab === role ? 'var(--color-primary, #3182ce)' : '#4a5568',
              marginBottom: -2,
            }}
          >
            {t(`permission.role_${role}`)}
            <span
              style={{
                marginLeft: 6,
                background: activeTab === role ? 'var(--color-primary, #3182ce)' : '#e2e8f0',
                color: activeTab === role ? '#fff' : '#4a5568',
                borderRadius: 10,
                padding: '1px 7px',
                fontSize: 11,
              }}
            >
              {users.filter((u) => u.role === role).length}
            </span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div
        style={{
          background: '#fff',
          border: '1px solid var(--color-border, #e2e8f0)',
          borderRadius: 8,
          padding: '16px 20px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>
            {t(`permission.role_${activeTab}`)} {t('permission.users_label')}
          </h2>
          {canModifyTab && (
            <button
              className="btn btn-primary"
              style={{ padding: '6px 16px', fontSize: 13 }}
              onClick={() => {
                setSelectedUsers([]);
                setUserSearchQuery('');
                setSearchDropdownOpen(false);
                setFormOpen(true);
              }}
            >
              + {t('permission.add_user')}
            </button>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <input
            type="text"
            className="form-control"
            value={tabSearchQuery}
            onChange={(e) => setTabSearchQuery(e.target.value)}
            placeholder={t('permission.search_placeholder')}
            style={{ maxWidth: 320, fontSize: 13 }}
          />
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            {t('common.loading')}
          </div>
        ) : (
          <UserTable
            users={usersForTab}
            canModify={canModifyTab}
            onRequestDelete={setDeleteTarget}
            deletingId={deletingId}
          />
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('permission.delete_modal_title')}
        footer={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={deletingId !== null}
            >
              {t('common.cancel')}
            </button>
            <button
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={deletingId !== null}
            >
              {deletingId !== null ? '...' : t('permission.delete_yes')}
            </button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 14 }}>
          {t('permission.delete_modal_body')}
        </p>
      </Modal>

      {/* Add User Modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={`${t('permission.add_user')} — ${t(`permission.role_${activeTab}`)}`}
        size="lg"
        style={{ minHeight: 480 }}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setFormOpen(false)} disabled={submitting}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? t('common.loading') : t('permission.add_user')}
            </button>
          </>
        }
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 240 }}>
          <div className="form-group">
            <label className="form-label">{t('permission.select_user')} <span className="required">*</span></label>

            {/* 검색 입력 + 드롭다운 */}
            <div ref={searchContainerRef} style={{ position: 'relative' }}>
              <input
                type="text"
                className="form-control"
                value={userSearchQuery}
                placeholder={t('permission.select_user_placeholder')}
                autoComplete="off"
                onChange={(e) => {
                  setUserSearchQuery(e.target.value);
                  setSearchDropdownOpen(true);
                }}
                onFocus={() => {
                  if (userSearchQuery) setSearchDropdownOpen(true);
                }}
              />
              {searchDropdownOpen && filteredUsers.length > 0 && (
                <ul
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 9999,
                    background: 'var(--bg-modal, #fff)',
                    border: '1px solid var(--color-border, #e2e8f0)',
                    borderRadius: 4,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                    margin: 0,
                    padding: 0,
                    listStyle: 'none',
                    maxHeight: 220,
                    overflowY: 'auto',
                  }}
                >
                  {filteredUsers.map((user) => (
                    <li
                      key={user.id}
                      onMouseDown={(e) => { e.preventDefault(); handleSelectUser(user); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.9rem' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLLIElement).style.background = 'var(--bg-secondary, #f7fafc)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLLIElement).style.background = 'transparent'; }}
                    >
                      <span style={{ fontWeight: 600 }}>{user.display_name}</span>
                      <span style={{ color: '#718096', marginLeft: 8, fontSize: 12 }}>
                        {user.username} · {user.email} · {user.department || '부서없음'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {usersForAssignment.length === 0 && (
              <p style={{ fontSize: 13, color: '#718096', marginTop: 8 }}>
                {t('permission.no_users_for_assignment')}
              </p>
            )}

            {/* 선택된 사용자 태그 목록 */}
            {selectedUsers.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {selectedUsers.map((user) => (
                  <span
                    key={user.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      background: '#e3f2fd',
                      padding: '3px 8px',
                      borderRadius: 3,
                      fontSize: 13,
                    }}
                  >
                    <strong>{user.display_name}</strong>
                    <span style={{ color: '#718096', marginLeft: 4, fontSize: 12 }}>
                      {user.username} · {user.department || '부서없음'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveUser(user.id)}
                      style={{
                        marginLeft: 6,
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        color: '#666',
                        padding: 0,
                        fontSize: 12,
                        lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

        </form>
      </Modal>
    </div>
  );
}
