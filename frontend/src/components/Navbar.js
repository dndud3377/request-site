import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function Navbar() {
  const { t, i18n } = useTranslation();
  const location = useLocation();

  const navLinks = [
    { to: '/', key: 'nav.home' },
    { to: '/intro', key: 'nav.intro' },
    { to: '/request', key: 'nav.request' },
    { to: '/approval', key: 'nav.approval' },
    { to: '/history', key: 'nav.history' },
    { to: '/voc', key: 'nav.voc' },
    { to: '/rfg', key: 'nav.rfg' },
  ];

  const switchLang = (lang) => {
    i18n.changeLanguage(lang);
  };

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="navbar-logo">
          <div className="navbar-logo-icon">🗺️</div>
          <span>ProductMap</span>
        </Link>

        <div className="navbar-links">
          {navLinks.map(({ to, key }) => (
            <Link
              key={to}
              to={to}
              className={`nav-link ${
                (to === '/' ? location.pathname === '/' : location.pathname.startsWith(to))
                  ? 'active'
                  : ''
              }`}
            >
              {t(key)}
            </Link>
          ))}
        </div>

        <div className="navbar-actions">
          <div className="lang-toggle">
            <button
              className={`lang-btn ${i18n.language === 'ko' ? 'active' : ''}`}
              onClick={() => switchLang('ko')}
            >
              KO
            </button>
            <button
              className={`lang-btn ${i18n.language === 'en' ? 'active' : ''}`}
              onClick={() => switchLang('en')}
            >
              EN
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
