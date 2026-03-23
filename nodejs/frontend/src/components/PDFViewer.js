import React, { useState } from 'react';
import './PDFViewer.css';

const PDFViewer = ({ pdfUrl, invoiceNumber }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const handleLoad = () => {
    setLoading(false);
  };

  const handleError = () => {
    setLoading(false);
    setError('Failed to load PDF');
  };

  return (
    <div className="pdf-viewer">
      {loading && (
        <div className="pdf-loading">
          <div className="spinner"></div>
          <p>Loading PDF...</p>
        </div>
      )}
      {error && (
        <div className="pdf-error">
          <p>{error}</p>
        </div>
      )}
      <iframe
        src={pdfUrl}
        title={`Invoice ${invoiceNumber}`}
        className="pdf-iframe"
        onLoad={handleLoad}
        onError={handleError}
        style={{ display: error ? 'none' : 'block' }}
      />
    </div>
  );
};

export default PDFViewer;

