import React from 'react';
import { useNavigate } from 'react-router-dom';
import './LoadInvoiceCreatorPage.css';

const LoadInvoiceCreatorPage = () => {
  const navigate = useNavigate();

  return (
    <div className="load-invoice-creator-page">
      <div className="page-header">
        <h2>Load Invoice Creator</h2>
        <div className="header-actions">
          <button className="secondary-btn" onClick={() => navigate('/print')}>
            Back to Invoices
          </button>
        </div>
      </div>

      <p className="page-description">
        Use this tool to manually create and print a single-load invoice. It runs inside the app (embedded) but prints
        from your browser.
      </p>

      <div className="tool-frame-wrap">
        <iframe
          title="Load Invoice Creator"
          className="tool-frame"
          src="/load-invoice-creator/load-invoice.html"
        />
      </div>
    </div>
  );
};

export default LoadInvoiceCreatorPage;

