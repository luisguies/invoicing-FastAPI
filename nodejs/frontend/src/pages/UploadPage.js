import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FileUpload from '../components/FileUpload';
import { uploadPDF } from '../services/api';
import './UploadPage.css';

const UploadPage = () => {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const navigate = useNavigate();

  const handleUpload = async (files) => {
    // Handle both single file and array of files
    const fileArray = Array.isArray(files) ? files : [files];
    
    if (fileArray.length === 0) {
      setError('No files selected');
      return;
    }

    setUploading(true);
    setMessage(null);
    setError(null);
    setProgress({ current: 0, total: fileArray.length });

    const results = [];
    const errors = [];

    try {
      // Process files sequentially
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        setProgress({ current: i + 1, total: fileArray.length });

        try {
          const result = await uploadPDF(file);
          if (result.success) {
            results.push({ file: file.name, success: true, load: result.load });
          } else {
            errors.push({ file: file.name, error: result.error || 'Failed to process PDF' });
          }
        } catch (err) {
          errors.push({ 
            file: file.name, 
            error: err.response?.data?.error || err.message || 'Failed to upload PDF' 
          });
        }
      }

      // Show results
      if (results.length > 0) {
        const successMsg = results.length === 1 
          ? 'PDF processed successfully! Load created.'
          : `${results.length} PDF(s) processed successfully! ${results.length} load(s) created.`;
        setMessage(successMsg);
        
        if (errors.length > 0) {
          setError(`${errors.length} file(s) failed: ${errors.map(e => e.file).join(', ')}`);
        }
        
        setTimeout(() => {
          navigate('/list');
        }, 3000);
      } else {
        setError('All files failed to process. ' + errors.map(e => `${e.file}: ${e.error}`).join('; '));
      }
    } catch (err) {
      setError(err.message || 'Failed to process files');
    } finally {
      setUploading(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  return (
    <div className="upload-page">
      <h2>Upload PDF Invoice</h2>
      <p className="page-description">
        Upload a PDF file to extract load information using OCR.
      </p>

      <FileUpload onUpload={handleUpload} uploading={uploading} />

      {uploading && progress.total > 0 && (
        <div className="upload-progress-info">
          Processing {progress.current} of {progress.total} file(s)...
        </div>
      )}

      {message && (
        <div className="message success">
          {message}
        </div>
      )}

      {error && (
        <div className="message error">
          Error: {error}
        </div>
      )}
    </div>
  );
};

export default UploadPage;

