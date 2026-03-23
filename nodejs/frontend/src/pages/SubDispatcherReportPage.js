import React, { useEffect, useState } from 'react';
import { getDispatchers, getSubDispatcherReport } from '../services/api';
import { formatDate } from '../utils/dateUtils';
import './SubDispatcherReportPage.css';

const SubDispatcherReportPage = () => {
  const [subDispatchers, setSubDispatchers] = useState([]);
  const [subDispatcherId, setSubDispatcherId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loads, setLoads] = useState([]);
  const [totalAmount, setTotalAmount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchDispatchers = async () => {
      try {
        const allDispatchers = await getDispatchers();
        const onlySubDispatchers = (allDispatchers || []).filter((d) => d.parent_id);
        setSubDispatchers(onlySubDispatchers);
        if (onlySubDispatchers.length > 0) {
          setSubDispatcherId(onlySubDispatchers[0]._id);
        }
      } catch (err) {
        setError(err.response?.data?.error || err.message || 'Failed to load sub-dispatchers');
      }
    };
    fetchDispatchers();
  }, []);

  const handleGenerate = async () => {
    if (!subDispatcherId) {
      setError('Select a sub-dispatcher');
      return;
    }

    setLoading(true);
    setLoaded(false);
    setError('');

    try {
      const report = await getSubDispatcherReport(subDispatcherId, dateFrom || undefined, dateTo || undefined);
      setLoads(report.loads || []);
      setTotalAmount(Number(report.totalAmount) || 0);
      setLoaded(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to generate report');
      setLoads([]);
      setTotalAmount(0);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const selectedSubDispatcher = subDispatchers.find((d) => d._id === subDispatcherId);

  return (
    <div className="sub-dispatcher-report-page">
      <h2>Sub-dispatcher Report</h2>
      <p className="page-description">
        Generate and print a report of loads created by a sub-dispatcher, filtered by date range.
      </p>

      <div className="report-form no-print">
        <div className="form-row">
          <label htmlFor="subDispatcher">Sub-dispatcher</label>
          <select
            id="subDispatcher"
            value={subDispatcherId}
            onChange={(e) => setSubDispatcherId(e.target.value)}
            disabled={loading}
          >
            <option value="">Select sub-dispatcher...</option>
            {subDispatchers.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-row date-row">
          <div>
            <label htmlFor="fromDate">From date</label>
            <input
              id="fromDate"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              disabled={loading}
            />
          </div>
          <div>
            <label htmlFor="toDate">To date</label>
            <input
              id="toDate"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="generate-btn" onClick={handleGenerate} disabled={loading}>
            {loading ? 'Loading...' : 'Generate report'}
          </button>
          {loaded && loads.length > 0 && (
            <button type="button" className="print-btn" onClick={handlePrint}>
              Print report
            </button>
          )}
        </div>
      </div>

      {error && <div className="message error no-print">{error}</div>}

      {loaded && (
        <div className="report-results">
          {loads.length === 0 ? (
            <p className="no-loads">No loads found for the selected sub-dispatcher and date range.</p>
          ) : (
            <>
              <div className="report-header print-only">
                <h3>Sub-dispatcher report: {selectedSubDispatcher?.name || 'Sub-dispatcher'}</h3>
                <p className="report-date-range">
                  {dateFrom && dateTo
                    ? `${formatDate(dateFrom)} - ${formatDate(dateTo)}`
                    : dateFrom
                      ? `From ${formatDate(dateFrom)}`
                      : dateTo
                        ? `Through ${formatDate(dateTo)}`
                        : 'All dates'}
                </p>
              </div>

              <table className="report-table">
                <thead>
                  <tr>
                    <th>Load #</th>
                    <th>Carrier</th>
                    <th>Driver</th>
                    <th>Pickup date</th>
                    <th>Delivery date</th>
                    <th>Origin</th>
                    <th>Destination</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {loads.map((load) => (
                    <tr key={load._id} className={load.cancelled ? 'cancelled' : ''}>
                      <td>{load.load_number}</td>
                      <td>{load.carrier_id?.name || '-'}</td>
                      <td>{load.driver_id?.name || '-'}</td>
                      <td>{formatDate(load.pickup_date)}</td>
                      <td>{formatDate(load.delivery_date)}</td>
                      <td>{[load.pickup_city, load.pickup_state].filter(Boolean).join(', ') || '-'}</td>
                      <td>{[load.delivery_city, load.delivery_state].filter(Boolean).join(', ') || '-'}</td>
                      <td className="num">${(Number(load.carrier_pay) || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="7" className="total-label">Total generated</td>
                    <td className="num total-amount">${totalAmount.toFixed(2)}</td>
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

export default SubDispatcherReportPage;
