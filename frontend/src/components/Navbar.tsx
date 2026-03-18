import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, MOCK_USERS, ROLE_LABEL } from '../contexts/AuthContext';
import { UserRole } from '../types';

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
];

const ROLE_ORDER: UserRole[] = ['PL', 'TE_R', 'TE_J', 'TE_O', 'TE_E', 'MASTER'];

export default function Navbar(): React.ReactElement {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { currentUser, switchRole } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const handleRoleSelect = (role: UserRole) => {
    switchRole(role);
    setDropdownOpen(false);
  };

  return (
    <nav className="navbar">
      <div className="navbar-inner">
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
          {/* 역할 선택 드롭다운 */}
          <div className="role-selector" ref={dropdownRef}>
            <button
              className="role-selector-btn"
              onClick={() => setDropdownOpen((v) => !v)}
              title="역할 전환 (테스트용)"
            >
              <span className="role-name">{currentUser.name}</span>
              <span className="role-badge">{ROLE_LABEL[currentUser.role]}</span>
              <span className="role-arrow">{dropdownOpen ? '▲' : '▼'}</span>
            </button>
            {dropdownOpen && (
              <div className="role-dropdown">
                {ROLE_ORDER.map((role) => {
                  const user = MOCK_USERS.find((u) => u.role === role)!;
                  return (
                    <button
                      key={role}
                      className={`role-dropdown-item ${currentUser.role === role ? 'active' : ''}`}
                      onClick={() => handleRoleSelect(role)}
                    >
                      <span className="role-dropdown-name">{user.name}</span>
                      <span className="role-dropdown-label">{ROLE_LABEL[role]}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

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
