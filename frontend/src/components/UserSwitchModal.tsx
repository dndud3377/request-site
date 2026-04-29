import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MockUser, UserRole } from '../types';
import { ROLE_LABEL, MOCK_USERS } from '../contexts/AuthContext';
import Modal from './Modal';

interface UserSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectUser: (user: MockUser) => void;
  currentUser: MockUser | null;
}

const ROLES: UserRole[] = ['NONE', 'PL', 'TE_R', 'TE_J', 'TE_O', 'TE_E', 'MASTER'];

export default function UserSwitchModal({
  isOpen,
  onClose,
  onSelectUser,
  currentUser,
}: UserSwitchModalProps) {
  const { t } = useTranslation();
  const [selectedRole, setSelectedRole] = useState<UserRole>('PL');
  const [selectedUser, setSelectedUser] = useState<MockUser | null>(null);

  // 역할별 사용자 필터링
  const filteredUsers = MOCK_USERS.filter((user) => user.role === selectedRole);

  const handleSelectUser = (user: MockUser) => {
    setSelectedUser(user);
  };

  const handleConfirm = () => {
    if (selectedUser) {
      onSelectUser(selectedUser);
      setSelectedUser(null);
      onClose();
    }
  };

  const handleCancel = () => {
    setSelectedUser(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title="사용자 전환"
      footer={
        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={handleCancel}>
            취소
          </button>
          <button
            style={{
              ...styles.confirmBtn,
              ...(selectedUser ? styles.confirmBtnActive : {}),
            }}
            onClick={handleConfirm}
            disabled={!selectedUser}
          >
            전환
          </button>
        </div>
      }
    >
      <div style={styles.container}>
        {/* 역할 탭 */}
        <div style={styles.roleTabs}>
          {ROLES.map((role) => (
            <button
              key={role}
              style={{
                ...styles.roleTab,
                ...(selectedRole === role ? styles.roleTabActive : {}),
              }}
              onClick={() => setSelectedRole(role)}
            >
              {ROLE_LABEL[role]}
            </button>
          ))}
        </div>

        {/* 사용자 목록 */}
        <div style={styles.userList}>
          <div style={styles.userListHeader}>
            {ROLE_LABEL[selectedRole]} 역할 사용자
          </div>
          <div style={styles.userGrid}>
            {filteredUsers.map((user) => {
              const isCurrentUser =
                currentUser?.username === user.username &&
                currentUser?.name === user.name;

              return (
                <button
                  key={user.id}
                  style={{
                    ...styles.userItem,
                    ...(selectedUser?.id === user.id ? styles.userItemSelected : {}),
                    ...(isCurrentUser ? styles.userItemCurrent : {}),
                  }}
                  onClick={() => handleSelectUser(user)}
                >
                  <div style={styles.userName}>{user.name}</div>
                  <div style={styles.userDept}>{user.department}</div>
                  {isCurrentUser && (
                    <div style={styles.currentBadge}>현재</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    minWidth: '500px',
  },
  roleTabs: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap' as const,
    borderBottom: '1px solid var(--border)',
    paddingBottom: '12px',
  },
  roleTab: {
    padding: '8px 16px',
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'var(--transition)',
  },
  roleTabActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
    color: '#fff',
  },
  userList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  userListHeader: {
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--text-primary)',
  },
  userGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: '8px',
    maxHeight: '300px',
    overflowY: 'auto' as const,
    padding: '8px',
    background: 'var(--bg-secondary)',
    borderRadius: '8px',
  },
  userItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '12px 8px',
    background: 'var(--bg-card)',
    border: '2px solid var(--border)',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'var(--transition)',
    position: 'relative' as const,
  },
  userItemSelected: {
    borderColor: 'var(--accent)',
    background: 'var(--accent-bg)',
  },
  userItemCurrent: {
    borderColor: 'var(--success)',
    background: 'var(--success-bg)',
  },
  userName: {
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--text-primary)',
  },
  userDept: {
    fontSize: '12px',
    color: 'var(--text-muted)',
  },
  currentBadge: {
    position: 'absolute' as const,
    top: '4px',
    right: '4px',
    fontSize: '10px',
    fontWeight: '700',
    color: 'var(--success)',
    background: 'var(--success-bg)',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
  cancelBtn: {
    padding: '8px 16px',
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'var(--transition)',
  },
  confirmBtn: {
    padding: '8px 16px',
    background: 'var(--border)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--text-muted)',
    cursor: 'not-allowed',
    transition: 'var(--transition)',
  },
  confirmBtnActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
    color: '#fff',
    cursor: 'pointer',
  },
};
