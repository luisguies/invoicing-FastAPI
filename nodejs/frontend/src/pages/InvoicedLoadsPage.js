import React, { useState, useEffect } from 'react';
import { searchInvoicedLoads, getCarriers, getDrivers, getDispatchers, markLoadAsInvoiced, patchLoadSubDispatcher, getLoadRateConfirmationUrl } from '../services/api';
import { formatDate, formatDateInput } from '../utils/dateUtils';
import './InvoicedLoadsPage.css';

const InvoicedLoadsPage = () => {
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [carriers, setCarriers] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [dispatchers, setDispatchers] = useState([]);
  const [filters, setFilters] = useState({
    carrier_id: '',
    load_number: '',
    driver_id: '',
    sub_dispatcher_id: '',
    pickup_date_from: '',
    delivery_date_to: ''
  });

  useEffect(() => {
    loadCarriers();
    loadDrivers();
    loadDispatchers();
    // Load all invoiced loads initially
    performSearch({});
  }, []);

  const loadCarriers = async () => {
    try {
      const data = await getCarriers();
      setCarriers(data || []);
    } catch (error) {
      console.error('Failed to load carriers:', error);
    }
  };

  const loadDrivers = async () => {
    try {
      const data = await getDrivers();
      setDrivers(data || []);
    } catch (error) {
      console.error('Failed to load drivers:', error);
    }
  };

  const loadDispatchers = async () => {
    try {
      const data = await getDispatchers();
      setDispatchers(data || []);
    } catch (error) {
      console.error('Failed to load dispatchers:', error);
    }
  };

  const subDispatchers = dispatchers.filter(d => d.parent_id);

  const performSearch = async (searchFilters = null) => {
    setLoading(true);
    try {
      const filtersToUse = searchFilters !== null ? searchFilters : filters;
      // Remove empty filters
      const cleanFilters = {};
      if (filtersToUse.carrier_id) cleanFilters.carrier_id = filtersToUse.carrier_id;
      if (filtersToUse.load_number) cleanFilters.load_number = filtersToUse.load_number;
      if (filtersToUse.driver_id) cleanFilters.driver_id = filtersToUse.driver_id;
      if (filtersToUse.sub_dispatcher_id) cleanFilters.sub_dispatcher_id = filtersToUse.sub_dispatcher_id;
      if (filtersToUse.pickup_date_from) cleanFilters.pickup_date_from = filtersToUse.pickup_date_from;
      if (filtersToUse.delivery_date_to) cleanFilters.delivery_date_to = filtersToUse.delivery_date_to;

      const data = await searchInvoicedLoads(cleanFilters);
      setLoads(data || []);
    } catch (error) {
      alert('Failed to search invoiced loads: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSearch = (e) => {
    e.preventDefault();
    performSearch(filters);
  };

  const handleClear = () => {
    const emptyFilters = {
      carrier_id: '',
      load_number: '',
      driver_id: '',
      sub_dispatcher_id: '',
      pickup_date_from: '',
      delivery_date_to: ''
    };
    setFilters(emptyFilters);
    performSearch(emptyFilters);
  };

  const handleUnmarkAsInvoiced = async (loadId) => {
    if (!window.confirm('Are you sure you want to remove this load from invoiced status? It will appear in the normal loads list again.')) {
      return;
    }

    try {
      await markLoadAsInvoiced(loadId, false);
      // Remove the load from the list since it's no longer invoiced
      setLoads(prevLoads => prevLoads.filter(load => load._id !== loadId));
    } catch (error) {
      alert('Failed to unmark load as invoiced: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleSubDispatcherChange = async (loadId, subDispatcherId) => {
    try {
      const updated = await patchLoadSubDispatcher(loadId, subDispatcherId || null);
      setLoads(prev => prev.map(l => l._id === loadId ? updated : l));
    } catch (error) {
      alert('Failed to update sub-dispatcher: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleViewRateConfirmation = (load) => {
    const hasRateConfirmationPath = Boolean((load?.rate_confirmation_path || '').toString().trim());
    if (!hasRateConfirmationPath) return;
    window.open(getLoadRateConfirmationUrl(load._id), '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="invoiced-loads-page">
      <div className="page-header">
        <h2>Invoiced Loads</h2>
        <button onClick={handleClear} className="refresh-btn">
          Clear Search
        </button>
      </div>

      <form className="search-form" onSubmit={handleSearch}>
        <div className="search-fields">
          <div className="search-field">
            <label htmlFor="carrier">Carrier:</label>
            <select
              id="carrier"
              value={filters.carrier_id}
              onChange={(e) => handleFilterChange('carrier_id', e.target.value)}
            >
              <option value="">All Carriers</option>
              {carriers.map(carrier => (
                <option key={carrier._id} value={carrier._id}>
                  {carrier.name}
                </option>
              ))}
            </select>
          </div>

          <div className="search-field">
            <label htmlFor="load_number">Load Number:</label>
            <input
              id="load_number"
              type="text"
              value={filters.load_number}
              onChange={(e) => handleFilterChange('load_number', e.target.value)}
              placeholder="Enter load number"
            />
          </div>

          <div className="search-field">
            <label htmlFor="driver">Driver:</label>
            <select
              id="driver"
              value={filters.driver_id}
              onChange={(e) => handleFilterChange('driver_id', e.target.value)}
            >
              <option value="">All Drivers</option>
              {drivers.map(driver => (
                <option key={driver._id} value={driver._id}>
                  {driver.name}
                </option>
              ))}
            </select>
          </div>

          <div className="search-field">
            <label htmlFor="sub_dispatcher">Sub-dispatcher:</label>
            <select
              id="sub_dispatcher"
              value={filters.sub_dispatcher_id}
              onChange={(e) => handleFilterChange('sub_dispatcher_id', e.target.value)}
            >
              <option value="">All</option>
              {subDispatchers.map(d => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="search-field">
            <label htmlFor="pickup_date_from">Pickup Date From:</label>
            <input
              id="pickup_date_from"
              type="date"
              value={filters.pickup_date_from}
              onChange={(e) => handleFilterChange('pickup_date_from', e.target.value)}
            />
            <small>Loads picked up from this date</small>
          </div>

          <div className="search-field">
            <label htmlFor="delivery_date_to">Delivery Date To:</label>
            <input
              id="delivery_date_to"
              type="date"
              value={filters.delivery_date_to}
              onChange={(e) => handleFilterChange('delivery_date_to', e.target.value)}
            />
            <small>Loads delivered on or before this date</small>
          </div>

          <button type="submit" className="search-btn" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {loading ? (
        <div className="loading">Searching invoiced loads...</div>
      ) : loads.length === 0 ? (
        <div className="no-loads">No invoiced loads found matching your search criteria.</div>
      ) : (
        <div className="loads-table-container">
          <table className="invoiced-loads-table">
            <thead>
              <tr>
                <th>Load #</th>
                <th>Carrier</th>
                <th>Driver</th>
                <th>Sub-dispatcher</th>
                <th>Pickup Date</th>
                <th>Delivery Date</th>
                <th>Origin</th>
                <th>Destination</th>
                <th>Amount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loads.map(load => {
                const currentSubId = load.sub_dispatcher_id ? (typeof load.sub_dispatcher_id === 'object' ? load.sub_dispatcher_id._id : load.sub_dispatcher_id) : '';
                const hasRateConfirmationPath = Boolean((load?.rate_confirmation_path || '').toString().trim());
                return (
                  <tr key={load._id}>
                    <td>{load.load_number}</td>
                    <td>{load.carrier_id?.name || 'N/A'}</td>
                    <td>{load.driver_id?.name || 'N/A'}</td>
                    <td>
                      <select
                        className="sub-dispatcher-select"
                        value={currentSubId}
                        onChange={(e) => handleSubDispatcherChange(load._id, e.target.value || null)}
                        title="Assign or change sub-dispatcher"
                      >
                        <option value="">(None)</option>
                        {subDispatchers.map(d => (
                          <option key={d._id} value={d._id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{formatDate(load.pickup_date)}</td>
                    <td>{formatDate(load.delivery_date)}</td>
                    <td>{load.pickup_city}, {load.pickup_state}</td>
                    <td>{load.delivery_city}, {load.delivery_state}</td>
                    <td>${Number(load.carrier_pay || 0).toFixed(2)}</td>
                    <td>
                      <button
                        onClick={() => handleViewRateConfirmation(load)}
                        className="view-rate-confirmation-btn"
                        disabled={!hasRateConfirmationPath}
                        title={hasRateConfirmationPath ? 'View rate confirmation' : 'Rate confirmation is not available'}
                      >
                        View Rate Confirmation
                      </button>
                      <button
                        onClick={() => handleUnmarkAsInvoiced(load._id)}
                        className="unmark-invoiced-btn"
                        title="Remove from invoiced status"
                      >
                        Unmark as Invoiced
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="results-count">
            Found {loads.length} invoiced load{loads.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoicedLoadsPage;
