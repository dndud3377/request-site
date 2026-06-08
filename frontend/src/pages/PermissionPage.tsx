import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { usersAPI, userGroupsAPI } from '../api/client';
import { useToast } from '../components/Toast';
import Modal, { ConfirmModal } from '../components/Modal';
import { UserRole, UserWithRole, UserForAssignment, UserGroup, UserGroupMember, AvailableGroupMember } from '../types';

const ALL_ROLES: UserRole[] = ['PL', 'TE_R', 'TE_P', 'TE_J', 'TE_O', 'TE_E', 'MASTER', 'NONE'];




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

// ===== My Group Section =====

interface MyGroupSectionProps {
  currentLoginid: string;
  currentRole: UserRole | null;
}

function MyGroupSection({ currentLoginid, currentRole }: MyGroupSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();

  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);

  // create form
  const [newGroupName, setNewGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  // per-group state
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<number>>(new Set());
  const [availableMembers, setAvailableMembers] = useState<Record<number, AvailableGroupMember[]>>({});
  const [memberSearchQuery, setMemberSearchQuery] = useState<Record<number, string>>({});
  const [memberDropdownOpen, setMemberDropdownOpen] = useState<Record<number, boolean>>({});
  const memberSearchRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // modals
  const [deleteTarget, setDeleteTarget] = useState<UserGroup | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [removeMemberTarget, setRemoveMemberTarget] = useState<{ group: UserGroup; member: UserGroupMember } | null>(null);
  const [removingMember, setRemovingMember] = useState(false);
  const [renameTarget, setRenameTarget] = useState<UserGroup | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const fetchGroups = useCallback(() => {
    setLoadingGroups(true);
    userGroupsAPI.list()
      .then(setGroups)
      .catch(() => setGroups([]))
      .finally(() => setLoadingGroups(false));
  }, []);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  // close member dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      setMemberDropdownOpen(prev => {
        const updated = { ...prev };
        Object.keys(memberSearchRefs.current).forEach(key => {
          const id = Number(key);
          const ref = memberSearchRefs.current[id];
          if (ref && !ref.contains(e.target as Node)) {
            updated[id] = false;
          }
        });
        return updated;
      });
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleExpand = (groupId: number) => {
    const isExpanding = !expandedGroupIds.has(groupId);
    setExpandedGroupIds(prev => {
      const next = new Set(prev);
      if (isExpanding) next.add(groupId); else next.delete(groupId);
      return next;
    });
    if (isExpanding) {
      userGroupsAPI.availableMembers(groupId)
        .then(data => setAvailableMembers(am => ({ ...am, [groupId]: data })))
        .catch(() => setAvailableMembers(am => ({ ...am, [groupId]: [] })));
    }
  };

  const refreshAvailableMembers = useCallback((groupId: number) => {
    userGroupsAPI.availableMembers(groupId)
      .then(data => setAvailableMembers(am => ({ ...am, [groupId]: data })))
      .catch(() => {});
  }, []);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) { addToast(t('group.name_required_error'), 'error'); return; }
    setCreating(true);
    try {
      const group = await userGroupsAPI.create(name);
      setGroups(prev => [group, ...prev]);
      setNewGroupName('');
      addToast(t('group.create_success'), 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('group.create_error');
      addToast(msg, 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    try {
      await userGroupsAPI.delete(deleteTarget.id);
      setGroups(prev => prev.filter(g => g.id !== deleteTarget.id));
      setDeleteTarget(null);
      addToast(t('group.delete_success'), 'success');
    } catch {
      addToast(t('group.delete_error'), 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleAddMember = async (groupId: number, userId: number) => {
    try {
      const updated = await userGroupsAPI.addMember(groupId, userId);
      setGroups(prev => prev.map(g => g.id === groupId ? updated : g));
      setMemberSearchQuery(q => ({ ...q, [groupId]: '' }));
      setMemberDropdownOpen(d => ({ ...d, [groupId]: false }));
      refreshAvailableMembers(groupId);
      addToast(t('group.add_member_success'), 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('group.add_member_error');
      addToast(msg, 'error');
    }
  };

  const handleRemoveMember = async () => {
    if (!removeMemberTarget) return;
    setRemovingMember(true);
    const { group, member } = removeMemberTarget;
    try {
      const updated = await userGroupsAPI.removeMember(group.id, member.id);
      // if current user removed themselves, remove group from list
      if (member.loginid === currentLoginid) {
        setGroups(prev => prev.filter(g => g.id !== group.id));
      } else {
        setGroups(prev => prev.map(g => g.id === group.id ? updated : g));
        refreshAvailableMembers(group.id);
      }
      setRemoveMemberTarget(null);
      addToast(t('group.remove_member_success'), 'success');
    } catch {
      addToast(t('group.remove_member_error'), 'error');
    } finally {
      setRemovingMember(false);
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) { addToast(t('group.name_required_error'), 'error'); return; }
    setRenaming(true);
    try {
      const updated = await userGroupsAPI.rename(renameTarget.id, name);
      setGroups(prev => prev.map(g => g.id === renameTarget.id ? updated : g));
      setRenameTarget(null);
      addToast(t('group.rename_success'), 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('group.rename_error');
      addToast(msg, 'error');
    } finally {
      setRenaming(false);
    }
  };

  const getFilteredAvailable = (groupId: number): AvailableGroupMember[] => {
    const all = availableMembers[groupId] || [];
    const q = (memberSearchQuery[groupId] || '').toLowerCase().trim();
    if (!q) return [];
    return all.filter(u =>
      u.loginid.toLowerCase().includes(q) ||
      u.name.toLowerCase().includes(q) ||
      u.mail.toLowerCase().includes(q) ||
      (u.deptname && u.deptname.toLowerCase().includes(q))
    );
  };

  const isRemoveConfirmSelf = removeMemberTarget?.member.loginid === currentLoginid;

  return (
    <div style={{ marginTop: 32 }}>
      {/* Section header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{t('group.section_title')}</h2>
        <p style={{ color: '#718096', fontSize: 14 }}>{t('group.section_subtitle')}</p>
      </div>

      {/* Create group form */}
      {currentRole && currentRole !== 'NONE' && (
        <form
          onSubmit={handleCreateGroup}
          style={{ display: 'flex', gap: 8, marginBottom: 20, maxWidth: 400 }}
        >
          <input
            type="text"
            className="form-control"
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            placeholder={t('group.create_placeholder')}
            style={{ fontSize: 14 }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={creating}
            style={{ whiteSpace: 'nowrap', padding: '6px 16px', fontSize: 13 }}
          >
            {creating ? t('common.loading') : `+ ${t('group.create')}`}
          </button>
        </form>
      )}

      {/* Group list */}
      {loadingGroups ? (
        <div style={{ color: '#999', fontSize: 14 }}>{t('common.loading')}</div>
      ) : groups.length === 0 ? (
        <div style={{ color: '#999', fontSize: 14, padding: '24px 0' }}>{t('group.no_groups')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map(group => {
            const isExpanded = expandedGroupIds.has(group.id);
            const isCreator = group.creator_loginid === currentLoginid;
            const filtered = getFilteredAvailable(group.id);
            const mq = memberSearchQuery[group.id] || '';
            const dropOpen = memberDropdownOpen[group.id] || false;

            return (
              <div
                key={group.id}
                style={{
                  background: '#fff',
                  border: '1px solid var(--color-border, #e2e8f0)',
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
              >
                {/* Card header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    cursor: 'pointer',
                    background: isExpanded ? 'var(--bg-secondary, #f7fafc)' : '#fff',
                    borderBottom: isExpanded ? '1px solid var(--color-border, #e2e8f0)' : 'none',
                  }}
                  onClick={() => toggleExpand(group.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{group.name}</span>
                    {isCreator && (
                      <span style={{
                        background: '#ebf8ff', color: '#2b6cb0',
                        fontSize: 11, padding: '1px 7px', borderRadius: 10, fontWeight: 600,
                      }}>
                        {t('group.creator_badge')}
                      </span>
                    )}
                    <span style={{ color: '#718096', fontSize: 13 }}>
                      {t('group.member_count', { count: group.members.length })}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '3px 10px', fontSize: 12 }}
                      onClick={() => { setRenameTarget(group); setRenameValue(group.name); }}
                    >
                      {t('group.rename')}
                    </button>
                    <button
                      className="btn btn-danger"
                      style={{ padding: '3px 10px', fontSize: 12 }}
                      onClick={() => setDeleteTarget(group)}
                    >
                      {t('group.delete')}
                    </button>
                  </div>
                </div>

                {/* Expanded body */}
                {isExpanded && (
                  <div style={{ padding: '12px 16px' }}>
                    {/* Member list */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid var(--color-border, #e2e8f0)' }}>
                          <th style={{ ...thStyle, width: 140 }}>로그인 ID</th>
                          <th style={thStyle}>이름</th>
                          <th style={thStyle}>부서</th>
                          <th style={{ ...thStyle, width: 80 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.members.map(member => {
                          const isSelf = member.loginid === currentLoginid;
                          const isGroupCreator = member.loginid === group.creator_loginid;
                          return (
                            <tr key={member.id} style={{ borderBottom: '1px solid var(--color-border, #e2e8f0)' }}>
                              <td style={tdStyle}>
                                <strong>{member.loginid}</strong>
                                {isSelf && (
                                  <span style={{
                                    marginLeft: 6, background: '#f0fff4', color: '#276749',
                                    fontSize: 11, padding: '1px 6px', borderRadius: 10,
                                  }}>
                                    {t('group.you_badge')}
                                  </span>
                                )}
                                {isGroupCreator && !isSelf && (
                                  <span style={{
                                    marginLeft: 6, background: '#ebf8ff', color: '#2b6cb0',
                                    fontSize: 11, padding: '1px 6px', borderRadius: 10,
                                  }}>
                                    {t('group.creator_badge')}
                                  </span>
                                )}
                              </td>
                              <td style={{ ...tdStyle, color: '#4a5568' }}>{member.name || '-'}</td>
                              <td style={{ ...tdStyle, color: '#718096', fontSize: 13 }}>{member.deptname || '-'}</td>
                              <td style={{ ...tdStyle, textAlign: 'right' }}>
                                {!isGroupCreator && (
                                  <button
                                    className="btn btn-danger"
                                    style={{ padding: '2px 10px', fontSize: 12 }}
                                    onClick={() => setRemoveMemberTarget({ group, member })}
                                  >
                                    {isSelf ? t('group.leave_group') : t('group.remove_member')}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {/* Add member search */}
                    <div
                      ref={el => { memberSearchRefs.current[group.id] = el; }}
                      style={{ position: 'relative', maxWidth: 360 }}
                    >
                      <input
                        type="text"
                        className="form-control"
                        value={mq}
                        onChange={e => {
                          setMemberSearchQuery(q => ({ ...q, [group.id]: e.target.value }));
                          setMemberDropdownOpen(d => ({ ...d, [group.id]: true }));
                        }}
                        onFocus={() => setMemberDropdownOpen(d => ({ ...d, [group.id]: true }))}
                        placeholder={t('group.add_member_placeholder')}
                        style={{ fontSize: 13 }}
                      />
                      {dropOpen && mq && (
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
                              onMouseDown={e => { e.preventDefault(); handleAddMember(group.id, u.id); }}
                              style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}
                              onMouseEnter={e => { (e.currentTarget as HTMLLIElement).style.background = 'var(--bg-secondary, #f7fafc)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLLIElement).style.background = 'transparent'; }}
                            >
                              <strong>{u.loginid}</strong>
                              <span style={{ color: '#718096', marginLeft: 8, fontSize: 12 }}>
                                {u.name} · {u.deptname || '부서없음'} · {u.mail}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete group confirm */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteGroup}
        title={t('group.delete_confirm_title')}
        message={deleteTarget ? t('group.delete_confirm_body', { name: deleteTarget.name }) : ''}
        confirmLabel={t('group.delete')}
        danger
        loading={deletingId !== null}
      />

      {/* Remove member confirm */}
      <ConfirmModal
        isOpen={removeMemberTarget !== null}
        onClose={() => setRemoveMemberTarget(null)}
        onConfirm={handleRemoveMember}
        title={isRemoveConfirmSelf ? t('group.leave_confirm_title') : t('group.remove_member_confirm_title')}
        message={isRemoveConfirmSelf ? t('group.leave_confirm_body') : t('group.remove_member_confirm_body')}
        confirmLabel={isRemoveConfirmSelf ? t('group.leave_group') : t('group.remove_member')}
        danger
        loading={removingMember}
      />

      {/* Rename modal */}
      <Modal
        isOpen={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title={t('group.rename')}
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setRenameTarget(null)} disabled={renaming}>
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
            onChange={e => setRenameValue(e.target.value)}
            placeholder={t('group.rename_placeholder')}
            autoFocus
            style={{ fontSize: 14 }}
          />
        </form>
      </Modal>
    </div>
  );
}

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

      {/* My Group Section */}
      <MyGroupSection
        currentLoginid={currentUser.username}
        currentRole={currentUser.role}
      />

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
