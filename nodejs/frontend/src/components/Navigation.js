import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { logout } from '../services/api';
import './Navigation.css';

const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/');
      window.location.reload(); // Force reload to clear state
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <nav className="navigation">
      <div className="nav-container">
        <h1 className="nav-title">Invoicing System</h1>
        <div className="nav-links">
          <Link 
            to="/upload" 
            className={location.pathname.startsWith('/upload') ? 'active' : ''}
          >
            Upload
          </Link>
          <Link 
            to="/list" 
            className={location.pathname === '/list' ? 'active' : ''}
          >
            Loads
          </Link>
          <Link
            to="/loads/new"
            className={location.pathname === '/loads/new' ? 'active' : ''}
          >
            Create Load
          </Link>
          <Link 
            to="/print" 
            className={location.pathname.startsWith('/print') ? 'active' : ''}
          >
            Invoices
          </Link>
          <Link
            to="/upload-old-invoices"
            className={location.pathname === '/upload-old-invoices' ? 'active' : ''}
          >
            Upload Old Invoices
          </Link>
          <Link
            to="/invoiced-loads"
            className={location.pathname === '/invoiced-loads' ? 'active' : ''}
          >
            Invoiced Loads
          </Link>
          <Link
            to="/calendar"
            className={location.pathname === '/calendar' ? 'active' : ''}
          >
            Calendar
          </Link>
          <Link
            to="/company-load-log"
            className={location.pathname === '/company-load-log' ? 'active' : ''}
          >
            Company Load Log
          </Link>
          <Link
            to="/sub-dispatcher-report"
            className={location.pathname === '/sub-dispatcher-report' ? 'active' : ''}
          >
            Sub-dispatcher Report
          </Link>
          <Link
            to="/tools/load-invoice-creator"
            className={location.pathname === '/tools/load-invoice-creator' ? 'active' : ''}
          >
            Load Invoice Creator
          </Link>
          <Link 
            to="/settings" 
            className={location.pathname.startsWith('/settings') ? 'active' : ''}
          >
            Settings
          </Link>
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;

