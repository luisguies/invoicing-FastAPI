import React, { useState, useEffect } from 'react';
import { formatDate, formatDateInput, parseDateInputToUtcDate } from '../utils/dateUtils';
import { updateLoad, cancelLoad, updateLoadCarrier, getCarriers, patchLoadDriver, markLoadAsInvoiced, getLoadRateConfirmationUrl, patchLoadSubDispatcher } from '../services/api';
import './LoadItem.css';

const LoadItem = ({ load, onUpdate, onDelete, drivers = [], driversLoading = false, ensureDriversLoaded, subDispatchers = [] }) => {
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [carriers, setCarriers] = useState([]);
  const [selectedCarrierId, setSelectedCarrierId] = useState('');
  const [saveAlias, setSaveAlias] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [formData, setFormData] = useState({
    load_number: load.load_number,
    carrier_pay: load.carrier_pay,
    pickup_date: formatDateInput(load.pickup_date),
    delivery_date: formatDateInput(load.delivery_date),
    pickup_city: load.pickup_city,
    pickup_state: load.pickup_state,
    delivery_city: load.delivery_city,
    delivery_state: load.delivery_state
  });

  const hasDriverConflicts = load.driver_conflict === true;
  const hasDuplicateConflicts = load.duplicate_conflict === true;
  const needsCarrierReview = !load.carrier_id && load.needs_review;
  const carrierId = load?.carrier_id?._id || null;
  const hasRateConfirmationPath = Boolean((load?.rate_confirmation_path || '').toString().trim());

  const driverConflictDetails = (() => {
    const ids = load.driver_conflict_ids;
    if (!Array.isArray(ids) || ids.length === 0) return null;
    // If populated, show load numbers; otherwise fall back to "N conflicting loads".
    const first = ids[0];
    const populated = first && typeof first === 'object' && !!first.load_number;
    if (populated) {
      const nums = ids.map((l) => l?.load_number).filter(Boolean);
      return nums.length > 0 ? `Driver conflict with load(s): ${nums.join(', ')}` : 'Driver conflict detected';
    }
    return `Driver conflict with ${ids.length} other load(s)`;
  })();

  const duplicateConflictDetails = (() => {
    const ids = load.duplicate_conflict_ids;
    if (!Array.isArray(ids) || ids.length === 0) return 'Duplicate load number for this carrier';
    return `Duplicate load number for this carrier (${ids.length + 1} total loads)`;
  })();

  const currentDriverId = (() => {
    if (!load?.driver_id) return null;
    if (typeof load.driver_id === 'string') return load.driver_id;
    return load.driver_id._id || null;
  })();

  const currentSubDispatcherId = (() => {
    if (!load?.sub_dispatcher_id) return '';
    if (typeof load.sub_dispatcher_id === 'string') return load.sub_dispatcher_id;
    return load.sub_dispatcher_id._id || '';
  })();

  // Load carriers when component mounts or when carrier_id is null
  useEffect(() => {
    if (needsCarrierReview) {
      loadCarriers();
    }
  }, [needsCarrierReview]);

  // Keep the dropdown in sync with the load prop
  useEffect(() => {
    setSelectedDriverId(currentDriverId ? currentDriverId.toString() : '');
  }, [currentDriverId]);

  // Lazily load drivers per carrier (cached in parent)
  useEffect(() => {
    if (carrierId && ensureDriversLoaded) {
      ensureDriversLoaded(carrierId.toString());
    }
  }, [carrierId, ensureDriversLoaded]);

  const loadCarriers = async () => {
    try {
      const carriersList = await getCarriers();
      setCarriers(carriersList);
    } catch (error) {
      console.error('Failed to load carriers:', error);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      if (!formData.pickup_date || !formData.delivery_date) {
        alert('Pickup and delivery dates are required.');
        return;
      }
      const pickupUtc = parseDateInputToUtcDate(formData.pickup_date);
      const deliveryUtc = parseDateInputToUtcDate(formData.delivery_date);
      if (!pickupUtc || !deliveryUtc) {
        alert('Invalid date format. Please use the date picker.');
        return;
      }
      const updatedLoad = await updateLoad(load._id, {
        ...formData,
        pickup_date: pickupUtc,
        delivery_date: deliveryUtc
      });
      onUpdate(updatedLoad, { refresh: true });
      setEditing(false);
    } catch (error) {
      alert('Failed to update load: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    setLoading(true);
    try {
      const updatedLoad = await cancelLoad(load._id, !load.cancelled);
      onUpdate(updatedLoad, { refresh: true });
    } catch (error) {
      alert('Failed to update load: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAsInvoiced = async (e) => {
    const newInvoicedStatus = e.target.checked;
    setLoading(true);
    try {
      const updatedLoad = await markLoadAsInvoiced(load._id, newInvoicedStatus);
      onUpdate(updatedLoad, { refresh: false });
    } catch (error) {
      // Revert checkbox on error
      e.target.checked = !newInvoicedStatus;
      alert('Failed to update load: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleCarrierSelect = async () => {
    if (!selectedCarrierId) {
      alert('Please select a carrier');
      return;
    }

    setLoading(true);
    try {
      const updatedLoad = await updateLoadCarrier(load._id, selectedCarrierId, saveAlias);
      onUpdate(updatedLoad, { refresh: true });
      setSelectedCarrierId('');
      setSaveAlias(false);
    } catch (error) {
      alert('Failed to update carrier: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleDriverChange = async (e) => {
    const nextValue = e.target.value; // '' means unassigned
    const previousValue = selectedDriverId;

    setSelectedDriverId(nextValue);
    setLoading(true);
    try {
      const driverIdOrNull = nextValue ? nextValue : null;
      const updatedLoad = await patchLoadDriver(load._id, driverIdOrNull);
      onUpdate(updatedLoad, { refresh: false });
    } catch (error) {
      setSelectedDriverId(previousValue);
      alert('Failed to update driver: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleSubDispatcherChange = async (e) => {
    const nextId = e.target.value || null;
    setLoading(true);
    try {
      const updatedLoad = await patchLoadSubDispatcher(load._id, nextId);
      onUpdate(updatedLoad, { refresh: false });
    } catch (error) {
      alert('Failed to update sub-dispatcher: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleViewRateConfirmation = () => {
    if (!hasRateConfirmationPath) return;
    window.open(getLoadRateConfirmationUrl(load._id), '_blank', 'noopener,noreferrer');
  };

  if (editing) {
    return (
      <tr className={`load-item editing ${load.cancelled ? 'cancelled' : ''}`}>
        <td>
          <input
            type="text"
            value={formData.load_number}
            onChange={(e) => setFormData({ ...formData, load_number: e.target.value })}
          />
        </td>
        <td>
          <input
            type="date"
            id={`pickup-date-${load._id}`}
            name="pickup_date"
            value={formData.pickup_date}
            onChange={(e) => setFormData((prev) => ({ ...prev, pickup_date: e.target.value }))}
          />
        </td>
        <td>
          <input
            type="date"
            id={`delivery-date-${load._id}`}
            name="delivery_date"
            value={formData.delivery_date}
            onChange={(e) => setFormData((prev) => ({ ...prev, delivery_date: e.target.value }))}
          />
        </td>
        <td>
          <input
            type="text"
            value={formData.pickup_city}
            onChange={(e) => setFormData({ ...formData, pickup_city: e.target.value })}
            placeholder="City"
          />
          <input
            type="text"
            value={formData.pickup_state}
            onChange={(e) => setFormData({ ...formData, pickup_state: e.target.value })}
            placeholder="State"
            style={{ width: '60px', marginLeft: '4px' }}
          />
        </td>
        <td>
          <input
            type="text"
            value={formData.delivery_city}
            onChange={(e) => setFormData({ ...formData, delivery_city: e.target.value })}
            placeholder="City"
          />
          <input
            type="text"
            value={formData.delivery_state}
            onChange={(e) => setFormData({ ...formData, delivery_state: e.target.value })}
            placeholder="State"
            style={{ width: '60px', marginLeft: '4px' }}
          />
        </td>
        <td>
          <input
            type="number"
            step="0.01"
            value={formData.carrier_pay}
            onChange={(e) => setFormData({ ...formData, carrier_pay: parseFloat(e.target.value) })}
          />
        </td>
        <td className="sub-dispatcher-cell">
          <select
            className="sub-dispatcher-select"
            value={currentSubDispatcherId}
            onChange={handleSubDispatcherChange}
            disabled={loading}
            title="Assign or change sub-dispatcher"
          >
            <option value="">(None)</option>
            {subDispatchers.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </select>
        </td>
        <td>
          <input
            type="checkbox"
            checked={load.invoiced || false}
            disabled={loading}
            onChange={handleMarkAsInvoiced}
          />
        </td>
        <td>
          <button onClick={handleSave} disabled={loading}>Save</button>
          <button onClick={() => setEditing(false)} disabled={loading}>Cancel</button>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`load-item ${load.cancelled ? 'cancelled' : ''} ${hasDriverConflicts ? 'driver-conflict' : ''} ${hasDuplicateConflicts ? 'duplicate-conflict' : ''} ${needsCarrierReview ? 'needs-review' : ''}`}>
      <td>
        {hasDriverConflicts && (
          <span className="warning-icon" title={driverConflictDetails || 'Driver conflict detected'}>👤⚠️</span>
        )}
        {hasDuplicateConflicts && (
          <span className="warning-icon" title={duplicateConflictDetails}>🔁</span>
        )}
        {needsCarrierReview && (
          <span className="warning-icon" title="Carrier needs review">🔍</span>
        )}
        {load.load_number}
      </td>
      <td>{formatDate(load.pickup_date)}</td>
      <td>{formatDate(load.delivery_date)}</td>
      <td>{load.pickup_city}, {load.pickup_state}</td>
      <td>{load.delivery_city}, {load.delivery_state}</td>
      <td className="amount">${load.carrier_pay?.toFixed(2)}</td>
      <td className="driver-cell">
        <select
          className="driver-dropdown"
          value={selectedDriverId}
          onChange={handleDriverChange}
          disabled={loading || !carrierId}
          title={!carrierId ? 'Assign a carrier first' : undefined}
        >
          <option value="">UNASSIGNED</option>
          {/* If a driver is already assigned but we haven't loaded the list yet, keep the selection stable */}
          {selectedDriverId &&
            (!Array.isArray(drivers) || drivers.length === 0) && (
              <option value={selectedDriverId}>
                {driversLoading ? 'Loading…' : 'Assigned (unknown)'}
              </option>
            )}
          {Array.isArray(drivers) &&
            drivers.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
        </select>
      </td>
      <td className="sub-dispatcher-cell">
        <select
          className="sub-dispatcher-select"
          value={currentSubDispatcherId}
          onChange={handleSubDispatcherChange}
          disabled={loading}
          title="Assign or change sub-dispatcher"
        >
          <option value="">(None)</option>
          {subDispatchers.map((d) => (
            <option key={d._id} value={d._id}>
              {d.name}
            </option>
          ))}
        </select>
      </td>
      <td className="carrier-cell">
        {needsCarrierReview ? (
          <div className="carrier-selector">
            <div className="carrier-info">
              <span className="carrier-raw">Extracted: {load.carrier_raw_extracted || 'N/A'}</span>
            </div>
            <select
              value={selectedCarrierId}
              onChange={(e) => setSelectedCarrierId(e.target.value)}
              disabled={loading}
              className="carrier-dropdown"
            >
              <option value="">Select carrier...</option>
              {carriers.map((carrier) => (
                <option key={carrier._id} value={carrier._id}>
                  {carrier.name}
                </option>
              ))}
            </select>
            {selectedCarrierId && load.carrier_raw_extracted && (
              <label className="alias-checkbox">
                <input
                  type="checkbox"
                  checked={saveAlias}
                  onChange={(e) => setSaveAlias(e.target.checked)}
                  disabled={loading}
                />
                Save '{load.carrier_raw_extracted}' as an alias for this carrier
              </label>
            )}
            <button
              onClick={handleCarrierSelect}
              disabled={loading || !selectedCarrierId}
              className="confirm-carrier-btn"
            >
              Confirm
            </button>
          </div>
        ) : (
          <span className="carrier-name">
            {load.carrier_id?.name || 'No carrier'}
          </span>
        )}
      </td>
      <td className="invoiced-cell">
        <input
          type="checkbox"
          checked={load.invoiced || false}
          onChange={handleMarkAsInvoiced}
          disabled={loading}
          title={load.invoiced ? 'Mark as not invoiced' : 'Mark as invoiced'}
          className="invoiced-checkbox"
        />
      </td>
      <td className="actions">
        <button
          onClick={handleViewRateConfirmation}
          disabled={loading || !hasRateConfirmationPath}
          className="view-rate-confirmation-btn"
          title={hasRateConfirmationPath ? 'View rate confirmation' : 'Rate confirmation is not available'}
        >
          View Rate Confirmation
        </button>
        <button
          className={load.cancelled ? 'uncancel-btn' : 'cancel-btn'}
          onClick={handleCancel}
          disabled={loading}
        >
          {load.cancelled ? 'Uncancel' : 'Cancel'}
        </button>
        <button onClick={() => setEditing(true)} disabled={loading}>Edit</button>
        {onDelete && (
          <button 
            onClick={() => {
              if (window.confirm('Are you sure you want to delete this load?')) {
                onDelete(load._id);
              }
            }} 
            disabled={loading}
            className="delete-btn"
          >
            Delete
          </button>
        )}
      </td>
    </tr>
  );
};

export default LoadItem;

