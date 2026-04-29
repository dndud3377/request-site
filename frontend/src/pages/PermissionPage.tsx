import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { usersAPI } from '../api/client';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import { UserRole, UserWithRole, UserForAssignment } from '../types';

const ALL_ROLES: UserRole[] = ['PL', 'TE_R', 'TE_J', 'TE_O', 'TE_E', 'MASTER', 'NONE'];

const ROLE_LABEL: Record<UserRole, string> = {
  PL: 'PL',
  TE_R: 'TE_R',
  TE_J: 'TE_J',
  TE_O: 'TE_O',
  TE_E: 'TE_E',
  MASTER: 'MASTER',
  NONE: '권한 없음',
};



// ===== Delete Confirm Row =====

interface DeleteConfirmProps {
  user: UserWithRole;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
}

function DeleteConfirm({ user, onCancel, onConfirm, loading }: DeleteConfirmProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
      <span style={{ fontSize: 13, color: 'var(--color-danger, #e53e3e)' }}>
        {t('permission.delete_confirm', { name: user.name })}
      </span>
      <button
        className="btn btn-danger"
        style={{ padding: '2px 10px', fontSize: 12 }}
        onClick={onConfirm}
        disabled={loading}
      >
        {loading ? '...' : t('permission.delete_yes')}
      </button>
      <button
        className="btn btn-secondary"
        style={{ padding: '2px 10px', fontSize: 12 }}
        onClick={onCancel}
        disabled={loading}
      >
        {t('common.cancel')}
      </button>
    </span>
  );
}

// ===== User Table =====

interface UserTableProps {
  users: UserWithRole[];
  canModify: boolean;
  onDelete: (user: UserWithRole) => void;
  deletingId: number | null;
  confirmingId: number | null;
  onConfirmDelete: (user: UserWithRole) => void;
  onCancelDelete: () => void;
}

function UserTable({
  users,
  canModify,
  onDelete,
  deletingId,
  confirmingId,
  onConfirmDelete,
  onCancelDelete,
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
          {canModify && <th style={{ ...thStyle, width: 120 }}></th>}
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id} style={{ borderBottom: '1px solid var(--color-border, #e2e8f0)' }}>
            <td style={tdStyle}>{user.loginid}</td>
            {canModify && (
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                {confirmingId === user.id ? (
                  <DeleteConfirm
                    user={user}
                    onCancel={onCancelDelete}
                    onConfirm={() => onDelete(user)}
                    loading={deletingId === user.id}
                  />
                ) : (
                  <button
                    className="btn btn-danger"
                    style={{ padding: '3px 12px', fontSize: 12 }}
                    onClick={() => onConfirmDelete(user)}
                    disabled={deletingId === user.id}
                  >
                    {t('permission.delete')}
                  </button>
                )}
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
  const [form, setForm] = useState<{ userId: string; role: UserRole }>({ userId: '', role: 'NONE' });
  const [submitting, setSubmitting] = useState(false);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const isMaster = currentUser.role === 'MASTER';

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

  const usersForTab = users.filter((u) => u.role === activeTab);

  const canModifyTab = isMaster || currentUser.role === activeTab;

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.userId) {
      addToast(t('permission.select_user_error'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      await usersAPI.assignRole(Number(form.userId), form.role);
      fetchUsers();
      fetchUsersForAssignment();
      addToast(t('permission.add_success'), 'success');
      setForm({ userId: '', role: activeTab });
      setFormOpen(false);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : t('permission.add_error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdded = (user: UserWithRole) => {
    setUsers((prev) => [...prev, user]);
    setActiveTab(user.role);
  };

  const handleConfirmDelete = (user: UserWithRole) => {
    setConfirmingId(user.id);
  };

  const handleCancelDelete = () => {
    setConfirmingId(null);
  };

  const handleDelete = async (user: UserWithRole) => {
    setDeletingId(user.id);
    try {
      await usersAPI.remove(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setConfirmingId(null);
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
            onClick={() => setActiveTab(role)}
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
            {ROLE_LABEL[role]}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>
            {ROLE_LABEL[activeTab]} {t('permission.users_label')}
          </h2>
          {canModifyTab && (
            <button
              className="btn btn-primary"
              style={{ padding: '6px 16px', fontSize: 13 }}
              onClick={() => {
                setForm({ userId: '', role: activeTab });
                setFormOpen(true);
              }}
            >
              + {t('permission.add_user')}
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            {t('common.loading')}
          </div>
        ) : (
          <UserTable
            users={usersForTab}
            canModify={canModifyTab}
            onDelete={handleDelete}
            deletingId={deletingId}
            confirmingId={confirmingId}
            onConfirmDelete={handleConfirmDelete}
            onCancelDelete={handleCancelDelete}
          />
        )}
      </div>

      {/* Add User Modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={t('permission.add_user')}
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
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">{t('permission.select_user')} <span className="required">*</span></label>
            <select
              className="form-control"
              name="userId"
              value={form.userId}
              onChange={handleFormChange}
              required
            >
              <option value="">-- {t('permission.select_user_placeholder')} --</option>
              {usersForAssignment.map(user => (
                <option key={user.id} value={user.id}>
                  {user.display_name} ({user.username}, {user.department || '부서없음'})
                </option>
              ))}
            </select>
            {usersForAssignment.length === 0 && (
              <p style={{ fontSize: 13, color: '#718096', marginTop: 8 }}>
                {t('permission.no_users_for_assignment')}
              </p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">{t('permission.field_role')} <span className="required">*</span></label>
            <select
              className="form-control"
              name="role"
              value={form.role}
              onChange={handleFormChange}
              required
            >
              {ALL_ROLES.filter(r => r !== 'NONE').map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </div>
        </form>
      </Modal>
    </div>
  );
}
