import React, { useState, useEffect } from 'react';
import { getCarriers, getLoadsLog } from '../services/api';
import { formatDate } from '../utils/dateUtils';
import './CompanyLoadLogPage.css';

const CompanyLoadLogPage = () => {
  const [carriers, setCarriers] = useState([]);
  const [carrierId, setCarrierId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchCarriers = async () => {
      try {
        const data = await getCarriers();
        setCarriers(data);
        if (data.length > 0 && !carrierId) {
          setCarrierId(data[0]._id);
        }
      } catch (err) {
        setError(err.response?.data?.error || err.message || 'Failed to load carriers');
      }
    };
    fetchCarriers();
  }, []);

  const handleGenerate = async () => {
    if (!carrierId) {
      setError('Select a company');
      return;
    }
    setLoading(true);
    setError(null);
    setLoaded(false);
    try {
      const data = await getLoadsLog(carrierId, dateFrom || undefined, dateTo || undefined);
      setLoads(data);
      setLoaded(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load log');
      setLoads([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const selectedCarrier = carriers.find((c) => c._id === carrierId);
  const totalPay = loads.reduce((sum, l) => sum + (Number(l.carrier_pay) || 0), 0);

  return (
    <div className="company-load-log-page">
      <h2>Company Load Log</h2>
      <p className="page-description">
        Generate a log of all loads for a specific company between selected dates.
      </p>

      <div className="log-form no-print">
        <div className="form-row">
          <label htmlFor="carrier">Company</label>
          <select
            id="carrier"
            value={carrierId}
            onChange={(e) => setCarrierId(e.target.value)}
            disabled={loading}
          >
            <option value="">Select company...</option>
            {carriers.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row date-row">
          <div>
            <label htmlFor="dateFrom">From date</label>
            <input
              id="dateFrom"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              disabled={loading}
            />
          </div>
          <div>
            <label htmlFor="dateTo">To date</label>
            <input
              id="dateTo"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="generate-btn"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Generate log'}
          </button>
          {loaded && loads.length > 0 && (
            <button type="button" className="print-btn" onClick={handlePrint}>
              Print log
            </button>
          )}
        </div>
      </div>

      {error && <div className="message error no-print">{error}</div>}

      {loaded && (
        <div className="log-results">
          {loads.length === 0 ? (
            <p className="no-loads">No loads found for the selected company and date range.</p>
          ) : (
            <>
              <div className="log-header print-only">
                <h3>Load log: {selectedCarrier?.name || 'Company'}</h3>
                <p className="log-date-range">
                  {dateFrom && dateTo
                    ? `${formatDate(dateFrom)} – ${formatDate(dateTo)}`
                    : dateFrom
                    ? `From ${formatDate(dateFrom)}`
                    : dateTo
                    ? `Through ${formatDate(dateTo)}`
                    : 'All dates'}
                </p>
              </div>
              <table className="log-table">
                <thead>
                  <tr>
                    <th>Load #</th>
                    <th>Driver</th>
                    <th>Pickup date</th>
                    <th>Delivery date</th>
                    <th>Origin</th>
                    <th>Destination</th>
                    <th className="num">Carrier pay</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loads.map((load) => (
                    <tr key={load._id} className={load.cancelled ? 'cancelled' : ''}>
                      <td>{load.load_number}</td>
                      <td>{load.driver_id?.name ?? '—'}</td>
                      <td>{formatDate(load.pickup_date)}</td>
                      <td>{formatDate(load.delivery_date)}</td>
                      <td>
                        {[load.pickup_city, load.pickup_state].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td>
                        {[load.delivery_city, load.delivery_state].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="num">${(Number(load.carrier_pay) || 0).toFixed(2)}</td>
                      <td>
                        {load.cancelled ? (
                          <span className="badge cancelled">Cancelled</span>
                        ) : load.invoiced ? (
                          <span className="badge invoiced">Invoiced</span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="6" className="total-label">
                      Total
                    </td>
                    <td className="num total-amount">${totalPay.toFixed(2)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default CompanyLoadLogPage;
