import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navigation from './components/Navigation';
import LoginPage from './pages/LoginPage';
import UploadPage from './pages/UploadPage';
import UploadOldInvoicesPage from './pages/UploadOldInvoicesPage';
import ListPage from './pages/ListPage';
import CreateLoadPage from './pages/CreateLoadPage';
import PrintPage from './pages/PrintPage';
import SettingsPage from './pages/SettingsPage';
import LoadInvoiceCreatorPage from './pages/LoadInvoiceCreatorPage';
import InvoicedLoadsPage from './pages/InvoicedLoadsPage';
import CalendarPage from './pages/CalendarPage';
import CompanyLoadLogPage from './pages/CompanyLoadLogPage';
import SubDispatcherReportPage from './pages/SubDispatcherReportPage';
import { checkAuth } from './services/api';
import './App.css';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const verifyAuth = async () => {
      try {
        const result = await checkAuth();
        setIsAuthenticated(result.authenticated);
      } catch (error) {
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };
    verifyAuth();
  }, []);

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  return (
    <Router>
      <div className="App">
        {isAuthenticated ? (
          <>
            <Navigation />
            <main className="main-content">
              <Routes>
                <Route path="/" element={<Navigate to="/upload" replace />} />
                <Route path="/upload" element={<UploadPage />} />
                <Route path="/upload-old-invoices" element={<UploadOldInvoicesPage />} />
                <Route path="/list" element={<ListPage />} />
                <Route path="/loads/new" element={<CreateLoadPage />} />
                <Route path="/tools/load-invoice-creator" element={<LoadInvoiceCreatorPage />} />
                <Route path="/invoiced-loads" element={<InvoicedLoadsPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/company-load-log" element={<CompanyLoadLogPage />} />
                <Route path="/sub-dispatcher-report" element={<SubDispatcherReportPage />} />
                <Route path="/print" element={<PrintPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </main>
          </>
        ) : (
          <Routes>
            <Route path="*" element={<LoginPage onLogin={() => setIsAuthenticated(true)} />} />
          </Routes>
        )}
      </div>
    </Router>
  );
}

export default App;

