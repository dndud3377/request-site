import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, MOCK_USERS, ROLE_LABEL } from '../contexts/AuthContext';
import { noticesAPI } from '../api/client';

const LAST_SEEN_NOTICE_KEY = 'last_seen_notice_id';

interface NavLink {
  to: string;
  key: string;
}

const NAV_LINKS: NavLink[] = [
  { to: '/', key: 'nav.home' },
  { to: '/request', key: 'nav.request' },
  { to: '/approval', key: 'nav.approval' },
  { to: '/history', key: 'nav.history' },
  { to: '/voc', key: 'nav.voc' },
  { to: '/permissions', key: 'nav.permissions' },
];

export default function Navbar(): React.ReactElement {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, switchUser, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [hasUnread, setHasUnread] = useState(false);

  const isActive = (to: string): boolean =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const handleUserSelect = (userId: number) => {
    switchUser(userId);
    setDropdownOpen(false);
  };

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
          {NAV_LINKS.map(({ to, key }) => (
            <Link
              key={to}
              to={to}
              className={`nav-link ${isActive(to) ? 'active' : ''}`}
            >
              {t(key as any)}
            </Link>
          ))}
        </div>

        <div className="navbar-actions">
          {/* 사용자 선택 드롭다운 */}
          <div className="role-selector" ref={dropdownRef}>
            <button
              className="role-selector-btn"
              onClick={() => setDropdownOpen((v) => !v)}
              title="사용자 전환 (테스트용)"
            >
              <span className="role-name">{currentUser.name}</span>
              <span className="role-badge">{ROLE_LABEL[currentUser.role]}</span>
              <span className="role-arrow">{dropdownOpen ? '▲' : '▼'}</span>
            </button>
            {dropdownOpen && (
              <div className="role-dropdown">
                {MOCK_USERS.map((user) => (
                  <button
                    key={user.id}
                    className={`role-dropdown-item ${currentUser.id === user.id ? 'active' : ''}`}
                    onClick={() => handleUserSelect(user.id)}
                  >
                    <span className="role-dropdown-name">{user.name}</span>
                    <span className="role-dropdown-label">{user.department}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 로그아웃 */}
          <button
            className="btn btn-secondary"
            style={{ padding: '5px 12px', fontSize: 13 }}
            onClick={logout}
            title={t('login.logout')}
          >
            {t('login.logout')}
          </button>

          {/* 언어 전환 */}
          <div className="lang-toggle">
            <button
              className={`lang-btn ${i18n.language === 'ko' ? 'active' : ''}`}
              onClick={() => i18n.changeLanguage('ko')}
            >
              KO
            </button>
            <button
              className={`lang-btn ${i18n.language === 'en' ? 'active' : ''}`}
              onClick={() => i18n.changeLanguage('en')}
            >
              EN
            </button>
          </div>

        </div>
      </div>
    </nav>
  );
}
