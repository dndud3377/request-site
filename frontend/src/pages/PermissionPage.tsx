import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { usersAPI, userGroupsAPI } from '../api/client';
import { useToast } from '../components/Toast';
import Modal, { ConfirmModal } from '../components/Modal';
import { UserRole, UserWithRole, UserForAssignment, UserGroup, UserGroupMember, AvailableGroupMember, GuideFeatureKey } from '../types';
import GuideSlidePanel from '../components/GuideSlidePanel';
import { GUIDE_DEMO_KEYS } from '../components/guideDemos';

const PERMISSION_GUIDE_KEY: GuideFeatureKey = 'permission_user_group';

const ALL_ROLES: UserRole[] = ['PL', 'TE_R', 'TE_P', 'TE_J', 'TE_O', 'TE_E', 'MASTER', 'NONE'];


// ===== Shared styles =====

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


// ===== User Table =====

const ASSIGNABLE_ROLES: UserRole[] = ['PL', 'TE_R', 'TE_P', 'TE_J', 'TE_O', 'TE_E', 'MASTER', 'NONE'];

interface UserTableProps {
  users: UserWithRole[];
  canModify: boolean;
  isMaster: boolean;
  onRequestDelete: (user: UserWithRole) => void;
  onRoleChange: (user: UserWithRole, newRole: UserRole) => void;
  deletingId: number | null;
  changingRoleId: number | null;
}

function UserTable({
  users,
  canModify,
  isMaster,
  onRequestDelete,
  onRoleChange,
  deletingId,
  changingRoleId,
}: UserTableProps): React.ReactElement {
  const { t } = useTranslation();

  if (users.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
        {t('permission.no_users')}
      </div>
    );
  }

  const showActionCol = isMaster || canModify;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid var(--color-border, #e2e8f0)' }}>
          <th style={thStyle}>{t('permission.field_loginid')}</th>
          <th style={thStyle}>{t('permission.field_name')}</th>
          <th style={thStyle}>{t('permission.field_email')}</th>
          <th style={thStyle}>{t('permission.field_department')}</th>
          {showActionCol && <th style={{ ...thStyle, width: isMaster ? 200 : 80 }}></th>}
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id} style={{ borderBottom: '1px solid var(--color-border, #e2e8f0)' }}>
            <td style={tdStyle}>{user.loginid}</td>
            <td style={tdStyle}>{user.name || '-'}</td>
            <td style={tdStyle}>{user.mail || '-'}</td>
            <td style={tdStyle}>{user.deptname || '-'}</td>
            {showActionCol && (
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                  {isMaster && (
                    <select
                      value={user.role}
                      onChange={(e) => onRoleChange(user, e.target.value as UserRole)}
                      disabled={changingRoleId === user.id}
                      style={{
                        fontSize: 12,
                        padding: '3px 6px',
                        borderRadius: 4,
                        border: '1px solid #cbd5e0',
                        background: 'var(--bg-modal, #fff)',
                        cursor: changingRoleId === user.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(`permission.role_${r}`)}
                        </option>
                      ))}
                    </select>
                  )}
                  {(isMaster || canModify) && (
                    <button
                      className="btn btn-danger"
                      style={{ padding: '3px 12px', fontSize: 12 }}
                      onClick={() => onRequestDelete(user)}
                      disabled={deletingId === user.id}
                    >
                      {deletingId === user.id ? '...' : t('permission.delete')}
                    </button>
                  )}
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}


// ===== AddGroupMemberModal =====

interface AddGroupMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: UserGroup;
  onMemberAdded: (updated: UserGroup) => void;
}

function AddGroupMemberModal({ isOpen, onClose, group, onMemberAdded }: AddGroupMemberModalProps): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();

  const [candidates, setCandidates] = useState<AvailableGroupMember[]>([]);
  const [selected, setSelected] = useState<AvailableGroupMember[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelected([]);
    setSearchQuery('');
    userGroupsAPI.availableMembers(group.id)
      .then(setCandidates)
      .catch(() => setCandidates([]));
  }, [isOpen, group.id]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = candidates.filter(u => {
    if (selected.some(s => s.id === u.id)) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      u.loginid.toLowerCase().includes(q) ||
      u.name.toLowerCase().includes(q) ||
      u.mail.toLowerCase().includes(q) ||
      (u.deptname && u.deptname.toLowerCase().includes(q))
    );
  });

  const handleSelect = (u: AvailableGroupMember) => {
    setSelected(prev => [...prev, u]);
    setSearchQuery('');
    setDropdownOpen(false);
  };

  const handleSubmit = async () => {
    if (selected.length === 0) return;
    setSubmitting(true);
    try {
      let lastUpdated: UserGroup = group;
      const results = await Promise.allSettled(
        selected.map(m => userGroupsAPI.addMember(group.id, m.id))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') lastUpdated = r.value;
      }
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      if (succeeded > 0) {
        onMemberAdded(lastUpdated);
        if (failed === 0) {
          addToast(t('group.add_member_success'), 'success');
        } else {
          addToast(t('group.add_member_error'), 'error');
        }
        onClose();
      } else {
        addToast(t('group.add_member_error'), 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${t('group.add_member_modal_title')} — ${group.name}`}
      size="md"
      style={{ minHeight: 360 }}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting || selected.length === 0}>
            {submitting ? t('common.loading') : t('group.add_member')}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 200 }}>
        <div ref={searchRef} style={{ position: 'relative' }}>
          <input
            type="text"
            className="form-control"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setDropdownOpen(true); }}
            onFocus={() => setDropdownOpen(true)}
            placeholder={t('group.add_member_placeholder')}
            style={{ fontSize: 13 }}
          />
          {dropdownOpen && (
            <ul style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
              background: 'var(--bg-modal, #fff)',
              border: '1px solid var(--color-border, #e2e8f0)',
              borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              margin: 0, padding: 0, listStyle: 'none',
              maxHeight: 200, overflowY: 'auto',
            }}>
              {filtered.length === 0 ? (
                <li style={{ padding: '10px 12px', color: '#999', fontSize: 13 }}>
                  {t('group.no_available_members')}
                </li>
              ) : filtered.map(u => (
                <li
                  key={u.id}
                  onMouseDown={e => { e.preventDefault(); handleSelect(u); }}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLLIElement).style.background = 'var(--bg-secondary, #f7fafc)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLLIElement).style.background = 'transparent'; }}
                >
                  <strong>{u.loginid}</strong>
                  <span style={{ color: '#718096', marginLeft: 8, fontSize: 12 }}>
                    {u.name} · {u.deptname || t('permission.no_department')} · {u.mail}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {selected.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {selected.map(u => (
              <span
                key={u.id}
                style={{
                  display: 'inline-flex', alignItems: 'center',
                  background: '#e3f2fd', padding: '3px 8px',
                  borderRadius: 3, fontSize: 13,
                }}
              >
                <strong>{u.loginid}</strong>
                <span style={{ color: '#718096', marginLeft: 4, fontSize: 12 }}>
                  {u.name}
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(prev => prev.filter(s => s.id !== u.id))}
                  style={{ marginLeft: 6, border: 'none', background: 'none', cursor: 'pointer', color: '#666', padding: 0, fontSize: 12, lineHeight: 1 }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}


// ===== CreateGroupModal =====

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRole: UserRole;
  currentLoginid: string;
  onCreated: (group: UserGroup) => void;
}

function CreateGroupModal({ isOpen, onClose, currentRole, currentLoginid, onCreated }: CreateGroupModalProps): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();

  const [groupName, setGroupName] = useState('');
  const [candidates, setCandidates] = useState<AvailableGroupMember[]>([]);
  const [selected, setSelected] = useState<AvailableGroupMember[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setGroupName('');
    setSelected([]);
    setSearchQuery('');
    setNameError('');
    // Load same-role users (excluding self)
    usersAPI.list(currentRole)
      .then(res => {
        const data = res.data as UserWithRole[];
        setCandidates(
          data
            .filter(u => u.loginid !== currentLoginid)
            .map(u => ({ id: u.id, loginid: u.loginid, name: u.name, mail: u.mail, deptname: u.deptname }))
        );
      })
      .catch(() => setCandidates([]));
  }, [isOpen, currentRole, currentLoginid]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = candidates.filter(u => {
    if (selected.some(s => s.id === u.id)) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      u.loginid.toLowerCase().includes(q) ||
      u.name.toLowerCase().includes(q) ||
      u.mail.toLowerCase().includes(q) ||
      (u.deptname && u.deptname.toLowerCase().includes(q))
    );
  });

  const handleSelect = (u: AvailableGroupMember) => {
    setSelected(prev => [...prev, u]);
    setSearchQuery('');
    setDropdownOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = groupName.trim();
    if (!name) { setNameError(t('group.name_required_error')); return; }
    setNameError('');
    setSubmitting(true);
    try {
      const group = await userGroupsAPI.create(name);
      if (selected.length > 0) {
        await Promise.allSettled(selected.map(m => userGroupsAPI.addMember(group.id, m.id)));
      }
      const finalGroup = await userGroupsAPI.get(group.id);
      onCreated(finalGroup);
      addToast(t('group.create_success'), 'success');
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('group.create_error');
      setNameError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('group.create_modal_title')}
      size="md"
      style={{ minHeight: 400 }}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? t('common.loading') : t('group.create')}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 200 }}>
        <div className="form-group">
          <label className="form-label">{t('group.create_placeholder')} <span className="required">*</span></label>
          <input
            type="text"
            className="form-control"
            value={groupName}
            onChange={e => { setGroupName(e.target.value); setNameError(''); }}
            placeholder={t('group.create_placeholder')}
            autoFocus
            style={{ fontSize: 14 }}
          />
          {nameError && <p style={{ color: '#e53e3e', fontSize: 12, marginTop: 4 }}>{nameError}</p>}
        </div>

        <div className="form-group">
          <label className="form-label">{t('group.add_member')}</label>
          <div ref={searchRef} style={{ position: 'relative' }}>
            <input
              type="text"
              className="form-control"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setDropdownOpen(true); }}
              onFocus={() => setDropdownOpen(true)}
              placeholder={t('group.add_member_placeholder')}
              style={{ fontSize: 13 }}
            />
            {dropdownOpen && (
              <ul style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
                background: 'var(--bg-modal, #fff)',
                border: '1px solid var(--color-border, #e2e8f0)',
                borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                margin: 0, padding: 0, listStyle: 'none',
                maxHeight: 200, overflowY: 'auto',
              }}>
                {filtered.length === 0 ? (
                  <li style={{ padding: '10px 12px', color: '#999', fontSize: 13 }}>
                    {t('group.no_available_members')}
                  </li>
                ) : filtered.map(u => (
                  <li
                    key={u.id}
                    onMouseDown={e => { e.preventDefault(); handleSelect(u); }}
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLLIElement).style.background = 'var(--bg-secondary, #f7fafc)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLLIElement).style.background = 'transparent'; }}
                  >
                    <strong>{u.loginid}</strong>
                    <span style={{ color: '#718096', marginLeft: 8, fontSize: 12 }}>
                      {u.name} · {u.deptname || t('permission.no_department')} · {u.mail}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {selected.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {selected.map(u => (
                <span
                  key={u.id}
                  style={{
                    display: 'inline-flex', alignItems: 'center',
                    background: '#e3f2fd', padding: '3px 8px',
                    borderRadius: 3, fontSize: 13,
                  }}
                >
                  <strong>{u.loginid}</strong>
                  <span style={{ color: '#718096', marginLeft: 4, fontSize: 12 }}>
                    {u.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelected(prev => prev.filter(s => s.id !== u.id))}
                    style={{ marginLeft: 6, border: 'none', background: 'none', cursor: 'pointer', color: '#666', padding: 0, fontSize: 12, lineHeight: 1 }}
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
  );
}


// ===== GroupTabContent =====

interface GroupTabContentProps {
  group: UserGroup;
  currentLoginid: string;
  onGroupUpdated: (updated: UserGroup) => void;
  onGroupDeleted: (id: number) => void;
}

function GroupTabContent({ group, currentLoginid, onGroupUpdated, onGroupDeleted }: GroupTabContentProps): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<UserGroupMember | null>(null);
  const [removing, setRemoving] = useState(false);

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = renameValue.trim();
    if (!name) { setRenameError(t('group.name_required_error')); return; }
    setRenameError('');
    setRenaming(true);
    try {
      const updated = await userGroupsAPI.rename(group.id, name);
      onGroupUpdated(updated);
      setRenameOpen(false);
      addToast(t('group.rename_success'), 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('group.rename_error');
      setRenameError(msg);
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await userGroupsAPI.delete(group.id);
      onGroupDeleted(group.id);
      addToast(t('group.delete_success'), 'success');
    } catch {
      addToast(t('group.delete_error'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleRemoveMember = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      const updated = await userGroupsAPI.removeMember(group.id, removeTarget.id);
      if (removeTarget.loginid === currentLoginid) {
        onGroupDeleted(group.id);
      } else {
        onGroupUpdated(updated);
      }
      setRemoveTarget(null);
      addToast(t('group.remove_member_success'), 'success');
    } catch {
      addToast(t('group.remove_member_error'), 'error');
    } finally {
      setRemoving(false);
    }
  };

  const isSelfRemove = removeTarget?.loginid === currentLoginid;

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid var(--color-border, #e2e8f0)',
        borderRadius: 8,
        padding: '16px 20px',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{group.name}</h2>
          <span style={{ color: '#718096', fontSize: 13 }}>
            {t('group.member_count', { count: group.members.length })}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            style={{ padding: '5px 14px', fontSize: 13 }}
            onClick={() => { setRenameValue(group.name); setRenameError(''); setRenameOpen(true); }}
          >
            {t('group.rename')}
          </button>
          <button
            className="btn btn-danger"
            style={{ padding: '5px 14px', fontSize: 13 }}
            onClick={() => setDeleteConfirmOpen(true)}
          >
            {t('group.delete')}
          </button>
          <button
            className="btn btn-primary"
            style={{ padding: '5px 14px', fontSize: 13 }}
            onClick={() => setAddMemberOpen(true)}
          >
            + {t('group.add_member')}
          </button>
        </div>
      </div>

      {/* Member table */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--color-border, #e2e8f0)' }}>
            <th style={thStyle}>{t('permission.field_loginid')}</th>
            <th style={thStyle}>{t('permission.field_name')}</th>
            <th style={thStyle}>{t('permission.field_email')}</th>
            <th style={thStyle}>{t('permission.field_department')}</th>
            <th style={{ ...thStyle, width: 100 }}></th>
          </tr>
        </thead>
        <tbody>
          {group.members.map(member => {
            const isSelf = member.loginid === currentLoginid;
            return (
              <tr key={member.id} style={{ borderBottom: '1px solid var(--color-border, #e2e8f0)' }}>
                <td style={tdStyle}><strong>{member.loginid}</strong></td>
                <td style={tdStyle}>{member.name || '-'}</td>
                <td style={tdStyle}>{member.mail || '-'}</td>
                <td style={tdStyle}>{member.deptname || '-'}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <button
                    className="btn btn-danger"
                    style={{ padding: '2px 10px', fontSize: 12 }}
                    onClick={() => setRemoveTarget(member)}
                  >
                    {isSelf ? t('group.leave_group') : t('group.remove_member')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Rename modal */}
      <Modal
        isOpen={renameOpen}
        onClose={() => setRenameOpen(false)}
        title={t('group.rename')}
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setRenameOpen(false)} disabled={renaming}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" onClick={handleRename} disabled={renaming}>
              {renaming ? t('common.loading') : t('common.save')}
            </button>
          </>
        }
      >
        <form onSubmit={handleRename} style={{ padding: '8px 0' }}>
          <input
            type="text"
            className="form-control"
            value={renameValue}
            onChange={e => { setRenameValue(e.target.value); setRenameError(''); }}
            placeholder={t('group.rename_placeholder')}
            autoFocus
            style={{ fontSize: 14 }}
          />
          {renameError && <p style={{ color: '#e53e3e', fontSize: 12, marginTop: 4 }}>{renameError}</p>}
        </form>
      </Modal>

      {/* Delete group confirm */}
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDelete}
        title={t('group.delete_confirm_title')}
        message={t('group.delete_confirm_body', { name: group.name })}
        confirmLabel={t('group.delete')}
        danger
        loading={deleting}
      />

      {/* Remove / Leave member confirm */}
      <ConfirmModal
        isOpen={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemoveMember}
        title={isSelfRemove ? t('group.leave_confirm_title') : t('group.remove_member_confirm_title')}
        message={isSelfRemove ? t('group.leave_confirm_body') : t('group.remove_member_confirm_body')}
        confirmLabel={isSelfRemove ? t('group.leave_group') : t('group.remove_member')}
        danger
        loading={removing}
      />

      {/* Add member modal */}
      <AddGroupMemberModal
        isOpen={addMemberOpen}
        onClose={() => setAddMemberOpen(false)}
        group={group}
        onMemberAdded={updated => { onGroupUpdated(updated); setAddMemberOpen(false); }}
      />
    </div>
  );
}


// ===== Main Page =====

export default function PermissionPage(): React.ReactElement {
  const { t } = useTranslation();
  const { currentUser, isLoading: authLoading } = useAuth();
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
  const [guidePanelOpen, setGuidePanelOpen] = useState(false);
  const [changingRoleId, setChangingRoleId] = useState<number | null>(null);
  const [tabSearchQuery, setTabSearchQuery] = useState('');

  // Group state
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);

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

  const fetchUsersForAssignment = useCallback((role?: string) => {
    usersAPI
      .forAssignment(role)
      .then((r) => setUsersForAssignment(r.data))
      .catch(() => setUsersForAssignment([]));
  }, []);

  const fetchGroups = useCallback(() => {
    userGroupsAPI.list()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchUsersForAssignment(isMaster ? activeTab : undefined);
  }, [fetchUsers, fetchUsersForAssignment, isMaster, activeTab]);

  useEffect(() => {
    if (authLoading) return;
    fetchGroups();
  }, [fetchGroups, authLoading]);

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

  const canModifyTab = activeTab !== 'NONE' && (isMaster || currentUser.role === activeTab);
  const canCreateGroup =
    activeGroupId === null &&
    currentUser.role === activeTab &&
    currentUser.role !== 'NONE' &&
    currentUser.role !== 'MASTER';

  const filteredUsers = usersForAssignment.filter((u) => {
    if (selectedUsers.some((s) => s.id === u.id)) return false;
    if (!userSearchQuery.trim()) return true;
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
        fetchUsersForAssignment(isMaster ? activeTab : undefined);
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

  const handleRoleChange = async (user: UserWithRole, newRole: UserRole) => {
    if (newRole === user.role) return;
    setChangingRoleId(user.id);
    try {
      await usersAPI.assignRole(user.id, newRole);
      addToast(t('permission.role_change_success'), 'success');
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : t('permission.role_change_error'), 'error');
    } finally {
      setChangingRoleId(null);
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

  const activeGroup = groups.find(g => g.id === activeGroupId) ?? null;

  const tabButtonStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '8px 18px',
    fontSize: 14,
    fontWeight: isActive ? 700 : 400,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    borderBottom: isActive ? '2px solid var(--color-primary, #3182ce)' : '2px solid transparent',
    color: isActive ? 'var(--color-primary, #3182ce)' : '#4a5568',
    marginBottom: -2,
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  });

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

      {/* Tab bar — role tabs + group tabs, horizontally scrollable */}
      <div style={{
        display: 'flex',
        gap: 4,
        flexWrap: 'nowrap',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        borderBottom: '2px solid var(--color-border, #e2e8f0)',
        paddingBottom: 0,
        marginBottom: 20,
      }}>
        {ALL_ROLES.map((role) => (
          <button
            key={role}
            onClick={() => { setActiveTab(role); setActiveGroupId(null); setTabSearchQuery(''); }}
            style={tabButtonStyle(activeGroupId === null && activeTab === role)}
          >
            {t(`permission.role_${role}`)}
            <span
              style={{
                marginLeft: 6,
                background: (activeGroupId === null && activeTab === role) ? 'var(--color-primary, #3182ce)' : '#e2e8f0',
                color: (activeGroupId === null && activeTab === role) ? '#fff' : '#4a5568',
                borderRadius: 10,
                padding: '1px 7px',
                fontSize: 11,
              }}
            >
              {users.filter((u) => u.role === role).length}
            </span>
          </button>
        ))}

        {groups.map(group => (
          <button
            key={`group_${group.id}`}
            onClick={() => { setActiveGroupId(group.id); setTabSearchQuery(''); }}
            style={tabButtonStyle(activeGroupId === group.id)}
          >
            {group.name}
            <span
              style={{
                marginLeft: 6,
                background: activeGroupId === group.id ? 'var(--color-primary, #3182ce)' : '#e2e8f0',
                color: activeGroupId === group.id ? '#fff' : '#4a5568',
                borderRadius: 10,
                padding: '1px 7px',
                fontSize: 11,
              }}
            >
              {group.members.length}
            </span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeGroupId !== null && activeGroup !== null ? (
        <GroupTabContent
          group={activeGroup}
          currentLoginid={currentUser.username}
          onGroupUpdated={updated => setGroups(prev => prev.map(g => g.id === updated.id ? updated : g))}
          onGroupDeleted={id => {
            setGroups(prev => prev.filter(g => g.id !== id));
            setActiveGroupId(null);
          }}
        />
      ) : (
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
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {GUIDE_DEMO_KEYS.includes(PERMISSION_GUIDE_KEY) && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); setGuidePanelOpen((v) => !v); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setGuidePanelOpen((v) => !v); }
                  }}
                  className={`guide-video-badge${guidePanelOpen ? ' active' : ''}`}
                >
                  {t('guide.video_btn')}
                </span>
              )}
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
              {canCreateGroup && (
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 16px', fontSize: 13 }}
                  onClick={() => setCreateGroupOpen(true)}
                >
                  + {t('group.create')}
                </button>
              )}
            </div>
          </div>

          <GuideSlidePanel
            featureKey={PERMISSION_GUIDE_KEY}
            featureTitle={t('guide.feat.permission_user_group')}
            isOpen={guidePanelOpen}
            onClose={() => setGuidePanelOpen(false)}
          />

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
              isMaster={isMaster}
              onRequestDelete={setDeleteTarget}
              onRoleChange={handleRoleChange}
              deletingId={deletingId}
              changingRoleId={changingRoleId}
            />
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('permission.delete_modal_title')}
        message={t('permission.delete_modal_body')}
        confirmLabel={t('permission.delete_yes')}
        danger
        loading={deletingId !== null}
      />

      {/* Add User Modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={`${t('permission.add_user')} — ${t(`permission.role_${activeTab}`)}`}
        size="md"
        style={{ minHeight: 240 }}
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
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 120 }}>
          <div className="form-group">
            <label className="form-label">{t('permission.select_user')} <span className="required">*</span></label>

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
                onFocus={() => setSearchDropdownOpen(true)}
              />
              {searchDropdownOpen && (
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
                  {filteredUsers.length === 0 ? (
                    <li style={{ padding: '10px 12px', color: '#999', fontSize: 13 }}>
                      {t('permission.no_users_for_assignment')}
                    </li>
                  ) : filteredUsers.map((user) => (
                    <li
                      key={user.id}
                      onMouseDown={(e) => { e.preventDefault(); handleSelectUser(user); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.9rem' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLLIElement).style.background = 'var(--bg-secondary, #f7fafc)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLLIElement).style.background = 'transparent'; }}
                    >
                      <span style={{ fontWeight: 600 }}>{user.display_name}</span>
                      <span style={{ color: '#718096', marginLeft: 8, fontSize: 12 }}>
                        {user.username} · {user.email} · {user.department || t('permission.no_department')}
                        {user.current_role && (
                          <span style={{ marginLeft: 6, color: '#3182ce', fontWeight: 500 }}>
                            ({t(`permission.role_${user.current_role}`)})
                          </span>
                        )}
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
                      {user.username} · {user.department || t('permission.no_department')}
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

      {/* Create Group Modal */}
      <CreateGroupModal
        isOpen={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        currentRole={activeTab}
        currentLoginid={currentUser.username}
        onCreated={group => {
          setGroups(prev => [...prev, group]);
          setActiveGroupId(group.id);
        }}
      />
    </div>
  );
}
