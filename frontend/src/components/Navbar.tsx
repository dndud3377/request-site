import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, ROLE_LABEL, MOCK_USERS, MockUser } from '../contexts/AuthContext';
import { noticesAPI, authAPI } from '../api/client';
import UserSwitchModal from './UserSwitchModal';

const LAST_SEEN_NOTICE_KEY = 'last_seen_notice_id';

interface NavLink {
  to: string;
  key: string;
}

// 역할별 접근 가능한 페이지
const ROLE_PERMISSIONS: Record<string, string[]> = {
  NONE: ['/', '/approval', '/history', '/voc', '/guide'],
  PL: ['/', '/request', '/approval', '/history', '/voc', '/guide', '/permissions'],
  TE_R: ['/', '/request', '/approval', '/history', '/voc', '/guide', '/permissions'],
  TE_J: ['/', '/request', '/approval', '/history', '/voc', '/guide', '/permissions'],
  TE_O: ['/', '/request', '/approval', '/history', '/voc', '/guide', '/permissions'],
  TE_E: ['/', '/request', '/approval', '/history', '/voc', '/guide', '/permissions'],
  MASTER: ['/', '/request', '/approval', '/history', '/voc', '/guide', '/permissions'],
};

const NAV_LINKS: NavLink[] = [
  { to: '/', key: 'nav.home' },
  { to: '/request', key: 'nav.request' },
  { to: '/approval', key: 'nav.approval' },
  { to: '/history', key: 'nav.history' },
  { to: '/voc', key: 'nav.voc' },
  { to: '/guide', key: 'nav.guide' },
  { to: '/permissions', key: 'nav.permissions' },
];

export default function Navbar(): React.ReactElement {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [hasUnread, setHasUnread] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [userSwitchModalOpen, setUserSwitchModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 포트 번호로 개발용 확인 (localhost:10011)
  const isDevMode = window.location.port === '10011';

  const handleLogout = async () => {
    setDropdownOpen(false);
    try {
      await authAPI.oidcLogout();
    } catch (e) {
      console.log('[Navbar] Logout API failed');
    }
    window.location.href = '/?logged_out=true';
  };

  // 사용자 전환 핸들러 (개발용 - AuthContext 의 switchUser 사용)
  const { switchUser } = useAuth();
  const handleSwitchUser = (user: MockUser) => {
    if (switchUser) {
      switchUser(user);
    }
  };

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isActive = (to: string): boolean =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  // 미확인 공지 여부 확인 (앱 마운트 시 1회)
  useEffect(() => {
    noticesAPI.latest().then((r) => {
      if (!r.data) return;
      const lastSeen = parseInt(localStorage.getItem(LAST_SEEN_NOTICE_KEY) ?? '0', 10);
      setHasUnread(r.data.id > lastSeen);
    }).catch(() => {});
  }, []);

  // 공지 배너 표시 후 unread 배지 갱신
  useEffect(() => {
    const handler = () => setHasUnread(false);
    window.addEventListener('notice-read', handler);
    return () => window.removeEventListener('notice-read', handler);
  }, []);

  const handleShowNotice = () => {
    localStorage.removeItem(LAST_SEEN_NOTICE_KEY);
    setHasUnread(false);
    if (location.pathname !== '/') {
      navigate('/');
      setTimeout(() => window.dispatchEvent(new CustomEvent('show-notice')), 100);
    } else {
      window.dispatchEvent(new CustomEvent('show-notice'));
    }
  };

  // 역할 표시 레이블 가져오기
  const roleLabel = currentUser.role ? ROLE_LABEL[currentUser.role] : ROLE_LABEL['null'];

  // 부서명에서 괄호와 그 내용 제거 (예: "FP 팀 (소속)" → "FP 팀")
  const cleanDepartment = currentUser.department ? currentUser.department.replace(/\(.*?\)/g, '').trim() : '';

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        {/* 확성기 아이콘 — 로고 왼쪽 */}
        <button
          className="notice-bell-btn"
          onClick={handleShowNotice}
          title="공지사항 보기"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>
            <path d="M9 18h6"/>
            <path d="M10 22h4"/>
          </svg>
          {hasUnread && <span className="notice-badge" />}
        </button>

        <Link to="/" className="navbar-logo">
          <div className="navbar-logo-icon">🗺️</div>
          <span>ProductMap</span>
        </Link>

        <div className="navbar-links">
          {NAV_LINKS.map(({ to, key }) => {
            // 역할별 접근 권한 확인
            const allowedPaths = ROLE_PERMISSIONS[currentUser.role || 'NONE'] || ['/'];
            if (!allowedPaths.includes(to)) return null;
            
            return (
              <Link
                key={to}
                to={to}
                className={`nav-link ${isActive(to) ? 'active' : ''}`}
              >
                {t(key as any)}
              </Link>
            );
          })}
        </div>

        <div className="navbar-actions">
          {/* 사용자 정보 + 설정 아이콘 + 드롭다운 */}
          <div className="user-info-wrapper" ref={dropdownRef}>
            <div 
              className="user-info" 
              onClick={() => setDropdownOpen(!dropdownOpen)}
              style={{ cursor: 'pointer' }}
            >
              <span className="user-name">{currentUser.name || currentUser.username}</span>
              <span className="user-department">{cleanDepartment}</span>
              <span className="user-role">{roleLabel}</span>
              {/* 설정 아이콘 */}
              <svg 
                className="settings-icon" 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2"
                style={{ marginLeft: 8 }}
              >
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </div>

            {/* 드롭다운 메뉴 */}
            {dropdownOpen && (
              <div className="user-dropdown">
                <div className="dropdown-item user-info-item">
                  <span className="dropdown-label">{t('profile.name') || '이름'}</span>
                  <span className="dropdown-value">{currentUser.name || currentUser.username}</span>
                </div>
                <div className="dropdown-item user-info-item">
                  <span className="dropdown-label">{t('profile.email') || '메일'}</span>
                  <span className="dropdown-value">{currentUser.email || '-'}</span>
                </div>
                <div className="dropdown-item user-info-item">
                  <span className="dropdown-label">{t('profile.department') || '부서'}</span>
                  <span className="dropdown-value">{currentUser.department || '-'}</span>
                </div>
                {isDevMode && (
                  <>
                    <div className="dropdown-divider" />
                    <div className="dropdown-item">
                      <button 
                        className="dropdown-btn"
                        onClick={() => { setUserSwitchModalOpen(true); setDropdownOpen(false); }}
                      >
                        🔄 사용자 전환
                      </button>
                    </div>
                  </>
                )}
                <div className="dropdown-divider" />
                <div className="dropdown-item lang-item">
                  <button
                    className={`lang-btn ${i18n.language === 'ko' ? 'active' : ''}`}
                    onClick={() => { i18n.changeLanguage('ko'); setDropdownOpen(false); }}
                  >
                    KO
                  </button>
                  <button
                    className={`lang-btn ${i18n.language === 'en' ? 'active' : ''}`}
                    onClick={() => { i18n.changeLanguage('en'); setDropdownOpen(false); }}
                  >
                    EN
                  </button>
                </div>
                <div className="dropdown-item">
                  <button 
                    className="dropdown-btn logout-btn"
                    onClick={handleLogout}
                  >
                    {t('login.logout')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 개발용 사용자 전환 모달 */}
      {isDevMode && (
        <UserSwitchModal
          isOpen={userSwitchModalOpen}
          onClose={() => setUserSwitchModalOpen(false)}
          onSelectUser={handleSwitchUser}
          currentUser={currentUser as MockUser}
        />
      )}
    </nav>
  );
}
