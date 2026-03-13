import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './i18n';
import './styles/global.css';
import Navbar from './components/Navbar';
import { ToastProvider } from './components/Toast';
import HomePage from './pages/HomePage';
import IntroPage from './pages/IntroPage';
import RequestPage from './pages/RequestPage';
import ApprovalPage from './pages/ApprovalPage';
import ApprovalRoutePage from './pages/ApprovalRoutePage';
import HistoryPage from './pages/HistoryPage';
import VOCPage from './pages/VOCPage';
import RFGPage from './pages/RFGPage';

function Footer(): React.ReactElement {
  return (
    <footer className="footer">
      <div className="container">
        © 2024 Product Introduction Map Request System. All rights reserved.
      </div>
    </footer>
  );
}

export default function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <ToastProvider>
        <div className="app-wrapper">
          <Navbar />
          <main className="main-content">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/intro" element={<IntroPage />} />
              <Route path="/request" element={<RequestPage />} />
              <Route path="/approval" element={<ApprovalPage />} />
              <Route path="/approval-route" element={<ApprovalRoutePage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/voc" element={<VOCPage />} />
              <Route path="/rfg" element={<RFGPage />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </ToastProvider>
    </BrowserRouter>
  );
}
