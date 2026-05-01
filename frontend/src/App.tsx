import React from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import './i18n';
import './styles/global.css';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Navbar from './components/Navbar';
import { ToastProvider } from './components/Toast';
import LoginPage from './pages/LoginPage';
import OIDCCallbackPage from './pages/OIDCCallbackPage';
import HomePage from './pages/HomePage';
import RequestPage from './pages/RequestPage';
import ApprovalPage from './pages/ApprovalPage';
import HistoryPage from './pages/HistoryPage';
import VOCPage from './pages/VOCPage';
import PermissionPage from './pages/PermissionPage';
import GuidePage from './pages/GuidePage';

function Footer(): React.ReactElement {
  return (
    <footer className="footer">
      <div className="container">
        © 2024 Product Introduction Map Request System. All rights reserved.
      </div>
    </footer>
  );
}

function LoadingSpinner(): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <div style={{ width: 40, height: 40, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
    </div>
  );
}

function AppContent(): React.ReactElement {
  const { isLoggedIn, isLoading } = useAuth();
  const location = useLocation();

  if (location.pathname === '/oidc-callback') return <OIDCCallbackPage />;
  if (isLoading) return <LoadingSpinner />;
  if (!isLoggedIn) return <LoginPage />;

  return (
    <div className="app-wrapper">
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/request" element={<RequestPage />} />
          <Route path="/approval" element={<ApprovalPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/voc" element={<VOCPage />} />
          <Route path="/permissions" element={<PermissionPage />} />
          <Route path="/guide" element={<GuidePage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

export default function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
