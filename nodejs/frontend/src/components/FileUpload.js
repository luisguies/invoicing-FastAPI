import React, { useState, useRef } from 'react';
import './FileUpload.css';

const FileUpload = ({ onUpload, uploading }) => {
  const [dragActive, setDragActive] = useState(false);
  const [uploadMode, setUploadMode] = useState('file'); // 'file' or 'folder'
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      const pdfFiles = files.filter(file => file.type === 'application/pdf');
      
      if (pdfFiles.length === 0) {
        alert('Please upload PDF files');
        return;
      }
      
      // Filter out files from subfolders (only root level files)
      // When dragging a folder, webkitRelativePath includes the folder name
      const rootLevelFiles = pdfFiles.filter(file => {
        if (!file.webkitRelativePath) {
          return true; // Assume root level if no path
        }
        const pathParts = file.webkitRelativePath.split('/');
        // Root level files: folder/file.pdf (length 2)
        // Subfolder files: folder/subfolder/file.pdf (length > 2)
        return pathParts.length === 2;
      });
      
      if (rootLevelFiles.length > 0) {
        onUpload(rootLevelFiles);
      } else {
        alert('No PDF files found in the root of the folder');
      }
    }
  };

  const handleFileChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      const pdfFiles = files.filter(file => file.type === 'application/pdf');
      
      if (pdfFiles.length === 0) {
        alert('Please upload PDF files');
        return;
      }
      
      onUpload(pdfFiles);
    }
  };

  const handleFolderChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      const pdfFiles = files.filter(file => file.type === 'application/pdf');
      
      if (pdfFiles.length === 0) {
        alert('No PDF files found in the selected folder');
        return;
      }
      
      // Filter out files from subfolders (only root level files)
      // When a folder is selected, webkitRelativePath includes the folder name
      // So root files have pathParts.length === 2 (folder/file), subfolder files have length > 2
      const rootLevelFiles = pdfFiles.filter(file => {
        if (!file.webkitRelativePath) {
          // If no webkitRelativePath, assume it's a root file
          return true;
        }
        const pathParts = file.webkitRelativePath.split('/');
        // Root level files: folder/file.pdf (length 2)
        // Subfolder files: folder/subfolder/file.pdf (length > 2)
        return pathParts.length === 2;
      });
      
      if (rootLevelFiles.length > 0) {
        onUpload(rootLevelFiles);
      } else {
        alert('No PDF files found in the root of the folder (subfolders are excluded)');
      }
    }
  };

  const handleFileClick = () => {
    if (uploadMode === 'file') {
      fileInputRef.current?.click();
    } else {
      folderInputRef.current?.click();
    }
  };

  return (
    <div className="file-upload-container">
      <div className="upload-mode-selector">
        <button
          type="button"
          className={`mode-btn ${uploadMode === 'file' ? 'active' : ''}`}
          onClick={() => setUploadMode('file')}
          disabled={uploading}
        >
          Single File
        </button>
        <button
          type="button"
          className={`mode-btn ${uploadMode === 'folder' ? 'active' : ''}`}
          onClick={() => setUploadMode('folder')}
          disabled={uploading}
        >
          Folder
        </button>
      </div>

      <div
        className={`file-upload-area ${dragActive ? 'drag-active' : ''} ${uploading ? 'uploading' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={handleFileClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          id="file-upload"
          accept=".pdf"
          onChange={handleFileChange}
          disabled={uploading}
          style={{ display: 'none' }}
          multiple={uploadMode === 'file'}
        />
        <input
          ref={folderInputRef}
          type="file"
          id="folder-upload"
          webkitdirectory=""
          directory=""
          accept=".pdf"
          onChange={handleFolderChange}
          disabled={uploading}
          style={{ display: 'none' }}
        />
        <div className="file-upload-label">
          {uploading ? (
            <div className="upload-progress">
              <div className="spinner"></div>
              <p>Processing PDFs...</p>
            </div>
          ) : (
            <>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <p className="upload-text">
                {uploadMode === 'file' 
                  ? 'Drag and drop PDF file(s) here, or click to select'
                  : 'Drag and drop a folder here, or click to select folder'}
              </p>
              <p className="upload-hint">
                {uploadMode === 'file' 
                  ? 'Only PDF files are supported'
                  : 'All PDF files in the root folder will be processed (subfolders excluded)'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default FileUpload;

