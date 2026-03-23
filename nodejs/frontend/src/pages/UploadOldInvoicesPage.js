import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadOldInvoice, extractOldInvoice, saveExtractedInvoice } from '../services/api';
import './UploadOldInvoicesPage.css';

// Optional "(PERSON NAME)" at end of filename is ignored
const OLD_INVOICE_FILENAME_REGEX = /^(.+)\s+Invoice\s+(\d{4}-\d{2}-\d{2})(?:\s*\([^)]*\))?\.pdf$/i;

function parseFilename(name) {
  const base = name.endsWith('.pdf') ? name : name + '.pdf';
  const match = base.match(OLD_INVOICE_FILENAME_REGEX);
  if (!match) return null;
  return { carrierName: match[1].trim(), dateStr: match[2] };
}

function ensureGroups(data) {
  const d = { ...data };
  if (!Array.isArray(d.groups)) d.groups = [];
  d.groups = d.groups.map((g) => ({
    groupLabel: g.groupLabel || '',
    groupRate: g.groupRate || '',
    lines: Array.isArray(g.lines) ? g.lines.map((l) => ({
      pickupDate: l.pickupDate || '',
      deliveryDate: l.deliveryDate || '',
      originCityState: l.originCityState || '',
      destCityState: l.destCityState || '',
      price: l.price || '',
      ratePercent: l.ratePercent || '',
      amount: l.amount || ''
    })) : []
  }));
  return d;
}

// Count total load lines across all groups
function countLoads(data) {
  if (!data || !Array.isArray(data.groups)) return 0;
  return data.groups.reduce((sum, g) => sum + (Array.isArray(g.lines) ? g.lines.length : 0), 0);
}

const UploadOldInvoicesPage = () => {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [step, setStep] = useState('select'); // 'select' | 'confirm' | 'batch-review'
  const [extractFile, setExtractFile] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [amountsByFilename, setAmountsByFilename] = useState({}); // filename -> { total, balanceDue } from preview
  const [previewingAmounts, setPreviewingAmounts] = useState(false);
  const [extractedList, setExtractedList] = useState([]); // [{ file, data?, error? }] after batch extract
  const [batchConfirmResults, setBatchConfirmResults] = useState(null); // { success: [], fail: [] } after Confirm
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const parsed = files.map((file) => ({
    file,
    parsed: parseFilename(file.name)
  }));
  const valid = parsed.filter((p) => p.parsed);
  const invalid = parsed.filter((p) => !p.parsed);
  const data = extractedData ? ensureGroups(extractedData) : null;

  const handleFileChange = (e) => {
    const chosen = Array.from(e.target.files || []);
    setFiles(chosen);
    setResults(null);
    setError(null);
    setAmountsByFilename({});
    setExtractedList([]);
    setBatchConfirmResults(null);
  };

  const handleBatchExtract = async () => {
    if (valid.length === 0) return;
    setExtracting(true);
    setError(null);
    setBatchConfirmResults(null);
    const list = [];
    try {
      for (let i = 0; i < valid.length; i++) {
        const { file } = valid[i];
        try {
          const res = await extractOldInvoice(file);
          const d = res.data || res;
          list.push({ file, data: d, error: null });
        } catch (err) {
          list.push({ file, data: null, error: err.response?.data?.error || err.message });
        }
      }
      setExtractedList(list);
      setStep('batch-review');
    } finally {
      setExtracting(false);
    }
  };

  const handleBatchConfirm = async () => {
    const toSave = extractedList.filter((item) => item.data && !item.error);
    if (toSave.length === 0) {
      setError('No extracted invoices to save. Fix extraction errors or go back.');
      return;
    }
    setSaving(true);
    setError(null);
    const successList = [];
    const failList = [];
    try {
      for (const item of toSave) {
        try {
          const payload = ensureGroups(item.data);
          await saveExtractedInvoice(item.file, payload);
          successList.push({ name: item.file.name, carrier: payload.carrierName || '' });
        } catch (err) {
          failList.push({ name: item.file.name, error: err.response?.data?.error || err.message });
        }
      }
      setBatchConfirmResults({ success: successList, fail: failList });
    } finally {
      setSaving(false);
    }
  };

  const handlePreviewAmounts = async () => {
    if (valid.length === 0) return;
    setPreviewingAmounts(true);
    setError(null);
    const next = {};
    try {
      for (const { file } of valid) {
        try {
          const res = await extractOldInvoice(file);
          const d = res.data || res;
          const total = d.total ?? d.balanceDue;
          const balanceDue = d.balanceDue ?? d.total;
          next[file.name] = { total, balanceDue };
        } catch (err) {
          next[file.name] = { error: err.response?.data?.error || err.message };
        }
      }
      setAmountsByFilename(next);
    } finally {
      setPreviewingAmounts(false);
    }
  };

  const handleExtract = async () => {
    if (valid.length !== 1) {
      setError('Select exactly one PDF to extract details.');
      return;
    }
    const { file } = valid[0];
    setExtracting(true);
    setError(null);
    try {
      const res = await extractOldInvoice(file);
      setExtractFile(file);
      setExtractedData(res.data || res);
      setStep('confirm');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  };

  const updateData = (key, value) => {
    setExtractedData((prev) => ({ ...prev, [key]: value }));
  };

  const updateGroup = (groupIndex, field, value) => {
    setExtractedData((prev) => {
      const next = { ...prev };
      next.groups = [...(next.groups || [])];
      next.groups[groupIndex] = { ...next.groups[groupIndex], [field]: value };
      return next;
    });
  };

  const updateLine = (groupIndex, lineIndex, field, value) => {
    setExtractedData((prev) => {
      const next = { ...prev };
      next.groups = [...(next.groups || [])];
      next.groups[groupIndex] = { ...next.groups[groupIndex] };
      next.groups[groupIndex].lines = [...(next.groups[groupIndex].lines || [])];
      next.groups[groupIndex].lines[lineIndex] = { ...next.groups[groupIndex].lines[lineIndex], [field]: value };
      return next;
    });
  };

  const handleSaveExtracted = async () => {
    if (!extractFile || !data) return;
    setSaving(true);
    setError(null);
    try {
      await saveExtractedInvoice(extractFile, data);
      setStep('select');
      setExtractFile(null);
      setExtractedData(null);
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      navigate('/print');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async () => {
    if (valid.length === 0) {
      setError(invalid.length > 0
        ? 'No valid filenames. Use format: "{Carrier Name} Invoice YYYY-MM-DD.pdf"'
        : 'Select PDF files first.');
      return;
    }
    setUploading(true);
    setError(null);
    setResults(null);
    const successList = [];
    const failList = [];
    try {
      for (const { file, parsed } of valid) {
        try {
          const res = await uploadOldInvoice(file);
          successList.push({ name: file.name, carrier: parsed.carrierName, date: parsed.dateStr, invoice: res.invoice });
        } catch (err) {
          failList.push({ name: file.name, error: err.response?.data?.error || err.message });
        }
      }
      setResults({ success: successList, fail: failList });
      if (successList.length > 0) setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setUploading(false);
    }
  };

  const clearResults = () => {
    setResults(null);
    setError(null);
  };

  const handleBackFromBatchReview = () => {
    setStep('select');
    setExtractedList([]);
    setBatchConfirmResults(null);
    setError(null);
  };

  if (step === 'batch-review' && extractedList.length > 0) {
    const toSave = extractedList.filter((item) => item.data && !item.error);
    return (
      <div className="upload-old-invoices-page batch-review-step">
        <h2>Review extracted invoices</h2>
        <p className="page-description">
          AI has read each invoice. Verify total and load count, then click Confirm to add loads and recreate invoices (carrier must exist in Settings).
        </p>
        {error && <div className="message error">{error}</div>}
        {!batchConfirmResults ? (
          <>
            <div className="batch-review-table-wrap">
              <table className="batch-review-table">
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Carrier</th>
                    <th>Date</th>
                    <th className="num">Total</th>
                    <th className="num"># Loads</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {extractedList.map((item, i) => {
                    const total = item.data ? (item.data.total ?? item.data.balanceDue) : null;
                    const loadCount = item.data ? countLoads(item.data) : 0;
                    return (
                      <tr key={i} className={item.error ? 'row-error' : ''}>
                        <td>{item.file.name}</td>
                        <td>{item.data?.carrierName ?? item.data?.billTo?.name ?? '—'}</td>
                        <td>{item.data?.invoiceDate ?? item.data?.dueDate ?? '—'}</td>
                        <td className="num">
                          {item.error ? '—' : total != null ? `$${Number(total).toFixed(2)}` : '—'}
                        </td>
                        <td className="num">{item.error ? '—' : loadCount}</td>
                        <td>
                          {item.error ? (
                            <span className="status-bad" title={item.error}>Error</span>
                          ) : (
                            <span className="status-ok">OK</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="batch-review-actions">
              <button type="button" className="back-btn" onClick={handleBackFromBatchReview} disabled={saving}>
                Back
              </button>
              <button
                type="button"
                className="save-extracted-btn"
                onClick={handleBatchConfirm}
                disabled={saving || toSave.length === 0}
              >
                {saving ? 'Saving...' : `Confirm and save ${toSave.length} invoice(s)`}
              </button>
            </div>
          </>
        ) : (
          <div className="batch-confirm-results">
            {batchConfirmResults.success.length > 0 && (
              <p className="results-success">
                {batchConfirmResults.success.length} invoice(s) saved. Loads created and invoices recreated.
                <button type="button" className="link-btn" onClick={() => navigate('/print')}>View Invoices</button>
              </p>
            )}
            {batchConfirmResults.fail.length > 0 && (
              <ul className="results-fail">
                {batchConfirmResults.fail.map((r, i) => (
                  <li key={i}>{r.name}: {r.error}</li>
                ))}
              </ul>
            )}
            <div className="batch-confirm-actions">
              <button type="button" className="back-btn" onClick={handleBackFromBatchReview}>
                Back to file select
              </button>
              <button type="button" className="link-btn" onClick={() => navigate('/print')}>
                Go to Invoices
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (step === 'confirm' && data) {
    const total = data.total ?? data.balanceDue;
    const balanceDue = data.balanceDue ?? data.total;
    const subtotal = data.subtotal ?? '';
    const postage = data.postage ?? '';
    return (
      <div className="upload-old-invoices-page confirm-step">
        <h2>Confirm invoice data</h2>
        <p className="page-description">
          Review and edit the extracted data, then click Confirm &amp; Save to create the invoice and loads.
        </p>
        {error && <div className="message error">{error}</div>}
        <div className="extracted-amounts-summary">
          <h3>Verify text detection — amounts</h3>
          <div className="amounts-grid">
            <div className="amount-item">
              <span className="amount-label">Subtotal</span>
              <span className="amount-value">${typeof subtotal === 'number' ? subtotal.toFixed(2) : (subtotal || '—')}</span>
            </div>
            <div className="amount-item">
              <span className="amount-label">Postage</span>
              <span className="amount-value">${typeof postage === 'number' ? postage.toFixed(2) : (postage || '—')}</span>
            </div>
            <div className="amount-item">
              <span className="amount-label">Total</span>
              <span className="amount-value">${typeof total === 'number' ? total.toFixed(2) : (total || '—')}</span>
            </div>
            <div className="amount-item">
              <span className="amount-label">Balance due</span>
              <span className="amount-value">${typeof balanceDue === 'number' ? balanceDue.toFixed(2) : (balanceDue || '—')}</span>
            </div>
          </div>
        </div>
        <div className="confirm-form">
          <section className="confirm-section">
            <h3>Header</h3>
            <div className="form-row">
              <label>Carrier (Bill To)</label>
              <input
                value={data.carrierName || ''}
                onChange={(e) => updateData('carrierName', e.target.value)}
                placeholder="Carrier name"
              />
            </div>
            <div className="form-row">
              <label>Invoice #</label>
              <input
                value={data.invoiceNumber || ''}
                onChange={(e) => updateData('invoiceNumber', e.target.value)}
                placeholder="Invoice number"
              />
            </div>
            <div className="form-row two-cols">
              <div>
                <label>Invoice Date</label>
                <input
                  type="text"
                  value={data.invoiceDate || ''}
                  onChange={(e) => updateData('invoiceDate', e.target.value)}
                  placeholder="YYYY-MM-DD"
                />
              </div>
              <div>
                <label>Due Date</label>
                <input
                  type="text"
                  value={data.dueDate || ''}
                  onChange={(e) => updateData('dueDate', e.target.value)}
                  placeholder="YYYY-MM-DD"
                />
              </div>
            </div>
            <div className="form-row three-cols">
              <div>
                <label>Subtotal</label>
                <input
                  type="text"
                  value={data.subtotal ?? ''}
                  onChange={(e) => updateData('subtotal', e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label>Postage</label>
                <input
                  type="text"
                  value={data.postage ?? ''}
                  onChange={(e) => updateData('postage', e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label>Total / Balance Due</label>
                <input
                  type="text"
                  value={data.total ?? data.balanceDue ?? ''}
                  onChange={(e) => {
                    updateData('total', e.target.value);
                    updateData('balanceDue', e.target.value);
                  }}
                  placeholder="0.00"
                />
              </div>
            </div>
          </section>
          <section className="confirm-section">
            <h3>Bill To</h3>
            <div className="form-row">
              <label>Name</label>
              <input
                value={data.billTo?.name ?? ''}
                onChange={(e) => setExtractedData((p) => ({ ...p, billTo: { ...(p.billTo || {}), name: e.target.value } }))}
              />
            </div>
            <div className="form-row">
              <label>Address / City State Zip</label>
              <input
                value={data.billTo?.cityStateZip ?? ''}
                onChange={(e) => setExtractedData((p) => ({ ...p, billTo: { ...(p.billTo || {}), cityStateZip: e.target.value } }))}
              />
            </div>
            <div className="form-row">
              <label>Phone</label>
              <input
                value={data.billTo?.phone ?? ''}
                onChange={(e) => setExtractedData((p) => ({ ...p, billTo: { ...(p.billTo || {}), phone: e.target.value } }))}
              />
            </div>
          </section>
          <section className="confirm-section">
            <h3>Payable To</h3>
            <div className="form-row">
              <label>Name</label>
              <input
                value={data.payableTo?.name ?? ''}
                onChange={(e) => setExtractedData((p) => ({ ...p, payableTo: { ...(p.payableTo || {}), name: e.target.value } }))}
              />
            </div>
            <div className="form-row">
              <label>Address / City State Zip</label>
              <input
                value={data.payableTo?.cityStateZip ?? ''}
                onChange={(e) => setExtractedData((p) => ({ ...p, payableTo: { ...(p.payableTo || {}), cityStateZip: e.target.value } }))}
              />
            </div>
            <div className="form-row">
              <label>Phone</label>
              <input
                value={data.payableTo?.phone ?? ''}
                onChange={(e) => setExtractedData((p) => ({ ...p, payableTo: { ...(p.payableTo || {}), phone: e.target.value } }))}
              />
            </div>
          </section>
          {(data.groups || []).map((group, gi) => (
            <section key={gi} className="confirm-section group-section">
              <h3>Driver: {group.groupLabel || '(unnamed)'}</h3>
              <div className="form-row two-cols">
                <div>
                  <label>Driver name</label>
                  <input
                    value={group.groupLabel || ''}
                    onChange={(e) => updateGroup(gi, 'groupLabel', e.target.value)}
                    placeholder="Driver name"
                  />
                </div>
                <div>
                  <label>Rate (e.g. 5%)</label>
                  <input
                    value={group.groupRate || ''}
                    onChange={(e) => updateGroup(gi, 'groupRate', e.target.value)}
                    placeholder="5%"
                  />
                </div>
              </div>
              <table className="confirm-lines-table">
                <thead>
                  <tr>
                    <th>Pickup</th>
                    <th>Delivery</th>
                    <th>Origin</th>
                    <th>Destination</th>
                    <th>Price</th>
                    <th>Rate</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(group.lines || []).map((line, li) => (
                    <tr key={li}>
                      <td><input value={line.pickupDate || ''} onChange={(e) => updateLine(gi, li, 'pickupDate', e.target.value)} /></td>
                      <td><input value={line.deliveryDate || ''} onChange={(e) => updateLine(gi, li, 'deliveryDate', e.target.value)} /></td>
                      <td><input value={line.originCityState || ''} onChange={(e) => updateLine(gi, li, 'originCityState', e.target.value)} /></td>
                      <td><input value={line.destCityState || ''} onChange={(e) => updateLine(gi, li, 'destCityState', e.target.value)} /></td>
                      <td><input value={line.price || ''} onChange={(e) => updateLine(gi, li, 'price', e.target.value)} /></td>
                      <td><input value={line.ratePercent || ''} onChange={(e) => updateLine(gi, li, 'ratePercent', e.target.value)} /></td>
                      <td><input value={line.amount || ''} onChange={(e) => updateLine(gi, li, 'amount', e.target.value)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
        <div className="confirm-actions">
          <button type="button" className="back-btn" onClick={() => { setStep('select'); setExtractFile(null); setExtractedData(null); setError(null); }} disabled={saving}>
            Back
          </button>
          <button type="button" className="save-extracted-btn" onClick={handleSaveExtracted} disabled={saving}>
            {saving ? 'Saving...' : 'Confirm & Save'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="upload-old-invoices-page">
      <h2>Upload Old Invoices</h2>
      <p className="page-description">
        Upload PDFs named <strong>{"{Carrier Name} Invoice YYYY-MM-DD.pdf"}</strong>. Use <strong>Extract all</strong> to have the AI read each invoice, then review total and load count and click Confirm to add loads and recreate invoices (carrier must exist in Settings). Or <strong>upload quickly</strong> (filename only) or <strong>extract one</strong> to edit before saving.
      </p>

      <div className="upload-old-area">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          onChange={handleFileChange}
          disabled={uploading || extracting}
          className="file-input"
        />
        <button
          type="button"
          className="browse-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || extracting}
        >
          {files.length === 0 ? 'Choose PDF files' : `Selected ${files.length} file(s)`}
        </button>
      </div>

      {parsed.length > 0 && (
        <div className="parsed-table-wrap">
          <table className="parsed-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Carrier</th>
                <th>Date</th>
                <th className="amount-col">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {parsed.map(({ file, parsed: p }, i) => {
                const amt = amountsByFilename[file.name];
                return (
                  <tr key={i} className={p ? '' : 'invalid'}>
                    <td>{file.name}</td>
                    <td>{p ? p.carrierName : '—'}</td>
                    <td>{p ? p.dateStr : '—'}</td>
                    <td className="amount-col">
                      {amt ? (
                        amt.error ? (
                          <span className="amount-error" title={amt.error}>Error</span>
                        ) : (
                          <span className="amount-value">${(amt.balanceDue ?? amt.total) != null ? Number(amt.balanceDue ?? amt.total).toFixed(2) : '—'}</span>
                        )
                      ) : (
                        <span className="amount-placeholder">—</span>
                      )}
                    </td>
                    <td>{p ? <span className="status-ok">OK</span> : <span className="status-bad">Invalid format</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="action-buttons">
            <button
              type="button"
              className="extract-all-btn"
              onClick={handleBatchExtract}
              disabled={extracting || valid.length === 0}
            >
              {extracting ? `Extracting... (${valid.length} file(s))` : 'Extract all (AI reads invoices)'}
            </button>
            {valid.length === 1 && (
              <button
                type="button"
                className="extract-btn"
                onClick={handleExtract}
                disabled={extracting || valid.length === 0}
              >
                {extracting ? 'Extracting...' : 'Extract details & confirm (edit first)'}
              </button>
            )}
            <button
              type="button"
              className="preview-amounts-btn"
              onClick={handlePreviewAmounts}
              disabled={previewingAmounts || valid.length === 0}
            >
              {previewingAmounts ? 'Detecting amounts...' : 'Preview amounts'}
            </button>
            <button
              type="button"
              className="upload-submit-btn"
              onClick={handleUpload}
              disabled={uploading || valid.length === 0}
            >
              {uploading ? 'Uploading...' : `Upload ${valid.length} invoice(s) (quick)`}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="message error" onClick={clearResults}>
          {error}
        </div>
      )}

      {results && (
        <div className="results-box">
          {results.success.length > 0 && (
            <p className="results-success">
              {results.success.length} invoice(s) added. <button type="button" className="link-btn" onClick={() => navigate('/print')}>View invoice list</button>
            </p>
          )}
          {results.fail.length > 0 && (
            <ul className="results-fail">
              {results.fail.map((r, i) => (
                <li key={i}>{r.name}: {r.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="nav-hint">
        <button type="button" className="link-btn" onClick={() => navigate('/print')}>Go to Invoices</button> to view and search all invoices.
      </p>
    </div>
  );
};

export default UploadOldInvoicesPage;
