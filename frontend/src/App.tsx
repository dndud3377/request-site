import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './i18n';
import './styles/global.css';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Navbar from './components/Navbar';
import SessionWarningModal from './components/SessionWarningModal';
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

function ProtectedRoute({ children }: { children: React.ReactElement }): React.ReactElement {
  const { currentUser } = useAuth();
  if (currentUser.role === 'NONE') return <Navigate to="/" replace />;
  return children;
}

const WARN_BEFORE_MS = 10 * 60 * 1000;

function AppContent(): React.ReactElement {
  const { isLoggedIn, isLoading, showWarning, extendSession, autoLogout } = useAuth();
  const location = useLocation();

  if (location.pathname === '/oidc-callback') return <OIDCCallbackPage />;
  if (location.pathname === '/logout') return <LoginPage />;
  if (isLoading) return <LoadingSpinner />;
  if (!isLoggedIn) return <LoginPage />;

  const routes = (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/request"     element={<ProtectedRoute><RequestPage /></ProtectedRoute>} />
      <Route path="/approval"    element={<ProtectedRoute><ApprovalPage /></ProtectedRoute>} />
      <Route path="/history"     element={<ProtectedRoute><HistoryPage /></ProtectedRoute>} />
      <Route path="/voc"         element={<ProtectedRoute><VOCPage /></ProtectedRoute>} />
      <Route path="/permissions" element={<ProtectedRoute><PermissionPage /></ProtectedRoute>} />
      <Route path="/guide"       element={<ProtectedRoute><GuidePage /></ProtectedRoute>} />
    </Routes>
  );

  // 전체 가이드 임베드 모드: 네비/푸터/세션 모달 없이 페이지 본문만 렌더 (iframe 미리보기용)
  const isTourEmbed = new URLSearchParams(location.search).get('embed') === 'tour';
  if (isTourEmbed) {
    return <div className="app-tour-embed">{routes}</div>;
  }

  return (
    <div className="app-wrapper">
      <SessionWarningModal
        visible={showWarning}
        remainingMs={WARN_BEFORE_MS}
        onExtend={extendSession}
        onLogout={autoLogout}
      />
      <Navbar />
      <main className="main-content">
        {routes}
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
