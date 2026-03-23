import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createLoad, getCarriers, getDriversByCarrier } from '../services/api';
import { parseDateInputToUtcDate } from '../utils/dateUtils';
import './CreateLoadPage.css';

const toUpperTrim = (s) => (s || '').toString().trim().toUpperCase();
const toTrim = (s) => (s || '').toString().trim();

const CreateLoadPage = () => {
  const navigate = useNavigate();

  const [carriers, setCarriers] = useState([]);
  const [drivers, setDrivers] = useState([]);

  const [loadingCarriers, setLoadingCarriers] = useState(true);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const [form, setForm] = useState({
    carrier_id: '',
    driver_id: '',
    load_number: '',
    carrier_pay: '',
    pickup_date: '',
    delivery_date: '',
    pickup_city: '',
    pickup_state: '',
    delivery_city: '',
    delivery_state: '',
    pdf_filename: 'manual-entry.pdf',
    cancelled: false,
    confirmed: false
  });

  const canChooseDriver = useMemo(() => !!form.carrier_id, [form.carrier_id]);

  useEffect(() => {
    const loadCarriers = async () => {
      setLoadingCarriers(true);
      try {
        const list = await getCarriers();
        setCarriers(Array.isArray(list) ? list : []);
      } catch (e) {
        setError(e.response?.data?.error || e.message || 'Failed to load carriers');
      } finally {
        setLoadingCarriers(false);
      }
    };
    loadCarriers();
  }, []);

  useEffect(() => {
    const loadDrivers = async () => {
      // Reset drivers any time the carrier changes.
      setDrivers([]);
      setForm((prev) => ({ ...prev, driver_id: '' }));

      if (!form.carrier_id) return;

      setLoadingDrivers(true);
      try {
        const list = await getDriversByCarrier(form.carrier_id);
        setDrivers(Array.isArray(list) ? list : []);
      } catch (e) {
        setError(e.response?.data?.error || e.message || 'Failed to load drivers');
      } finally {
        setLoadingDrivers(false);
      }
    };
    loadDrivers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.carrier_id]);

  const onChange = (key) => (e) => {
    const value = e?.target?.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validate = () => {
    const errors = [];
    if (!toTrim(form.load_number)) errors.push('Load # is required');
    if (!toTrim(form.pickup_date)) errors.push('Pickup date is required');
    if (!toTrim(form.delivery_date)) errors.push('Delivery date is required');
    if (!toTrim(form.pickup_city)) errors.push('Pickup city is required');
    if (!toTrim(form.pickup_state)) errors.push('Pickup state is required');
    if (!toTrim(form.delivery_city)) errors.push('Delivery city is required');
    if (!toTrim(form.delivery_state)) errors.push('Delivery state is required');
    if (!toTrim(form.pdf_filename)) errors.push('PDF filename is required (use something like "manual-entry.pdf")');

    const pay = Number(form.carrier_pay);
    if (!Number.isFinite(pay)) errors.push('Carrier pay must be a number');

    const pickupUtc = parseDateInputToUtcDate(form.pickup_date);
    const deliveryUtc = parseDateInputToUtcDate(form.delivery_date);
    if (!pickupUtc) errors.push('Pickup date is invalid');
    if (!deliveryUtc) errors.push('Delivery date is invalid');
    if (pickupUtc && deliveryUtc && pickupUtc.getTime() > deliveryUtc.getTime()) {
      errors.push('Pickup date must be on or before delivery date');
    }

    return { errors, pickupUtc, deliveryUtc, pay };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const { errors, pickupUtc, deliveryUtc, pay } = validate();
    if (errors.length > 0) {
      setError(errors.join('. '));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        carrier_id: form.carrier_id ? form.carrier_id : null,
        driver_id: form.driver_id ? form.driver_id : null,
        carrier_source: 'manual',
        needs_review: false,
        review_reason: null,
        load_number: toTrim(form.load_number),
        carrier_pay: pay,
        pickup_date: pickupUtc,
        delivery_date: deliveryUtc,
        pickup_city: toTrim(form.pickup_city),
        pickup_state: toUpperTrim(form.pickup_state),
        delivery_city: toTrim(form.delivery_city),
        delivery_state: toUpperTrim(form.delivery_state),
        pdf_filename: toTrim(form.pdf_filename),
        cancelled: !!form.cancelled,
        confirmed: !!form.confirmed
      };

      const created = await createLoad(payload);
      setMessage(`Load created: ${created?.load_number || payload.load_number}`);
      setTimeout(() => navigate('/list'), 600);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create load');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="create-load-page">
      <div className="page-header">
        <h2>Create Load</h2>
        <button className="secondary-btn" onClick={() => navigate('/list')} disabled={saving}>
          Back to Loads
        </button>
      </div>

      <p className="page-description">
        Manually create a load (carrier/driver, dates, origin/destination, amount, etc.).
      </p>

      <form className="create-load-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="form-group">
            <label>Carrier</label>
            <select value={form.carrier_id} onChange={onChange('carrier_id')} disabled={loadingCarriers || saving}>
              <option value="">(Unassigned)</option>
              {carriers.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
            <small>{loadingCarriers ? 'Loading carriers…' : 'Optional (but recommended).'}</small>
          </div>

          <div className="form-group">
            <label>Driver</label>
            <select
              value={form.driver_id}
              onChange={onChange('driver_id')}
              disabled={!canChooseDriver || loadingDrivers || saving}
              title={!canChooseDriver ? 'Select a carrier first' : undefined}
            >
              <option value="">UNASSIGNED</option>
              {drivers.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
            <small>
              {!canChooseDriver ? 'Select a carrier to load drivers.' : loadingDrivers ? 'Loading drivers…' : 'Optional.'}
            </small>
          </div>

          <div className="form-group">
            <label>Load # *</label>
            <input type="text" value={form.load_number} onChange={onChange('load_number')} disabled={saving} />
          </div>

          <div className="form-group">
            <label>Carrier Pay (Amount) *</label>
            <input
              type="number"
              step="0.01"
              value={form.carrier_pay}
              onChange={onChange('carrier_pay')}
              disabled={saving}
            />
          </div>

          <div className="form-group">
            <label>Pickup Date *</label>
            <input type="date" value={form.pickup_date} onChange={onChange('pickup_date')} disabled={saving} />
          </div>

          <div className="form-group">
            <label>Delivery Date *</label>
            <input type="date" value={form.delivery_date} onChange={onChange('delivery_date')} disabled={saving} />
          </div>

          <div className="form-group">
            <label>Pickup City *</label>
            <input type="text" value={form.pickup_city} onChange={onChange('pickup_city')} disabled={saving} />
          </div>

          <div className="form-group">
            <label>Pickup State *</label>
            <input
              type="text"
              maxLength={2}
              value={form.pickup_state}
              onChange={onChange('pickup_state')}
              disabled={saving}
            />
          </div>

          <div className="form-group">
            <label>Delivery City *</label>
            <input type="text" value={form.delivery_city} onChange={onChange('delivery_city')} disabled={saving} />
          </div>

          <div className="form-group">
            <label>Delivery State *</label>
            <input
              type="text"
              maxLength={2}
              value={form.delivery_state}
              onChange={onChange('delivery_state')}
              disabled={saving}
            />
          </div>

          <div className="form-group">
            <label>PDF Filename *</label>
            <input type="text" value={form.pdf_filename} onChange={onChange('pdf_filename')} disabled={saving} />
            <small>Required by the current DB schema. Any placeholder is fine (ex: manual-entry.pdf).</small>
          </div>

          <div className="form-group checkbox">
            <label>
              <input type="checkbox" checked={form.confirmed} onChange={onChange('confirmed')} disabled={saving} />
              Confirmed
            </label>
            <small>Optional.</small>
          </div>

          <div className="form-group checkbox">
            <label>
              <input type="checkbox" checked={form.cancelled} onChange={onChange('cancelled')} disabled={saving} />
              Cancelled
            </label>
            <small>Optional.</small>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="primary-btn" disabled={saving}>
            {saving ? 'Creating…' : 'Create Load'}
          </button>
        </div>

        {message && <div className="message success">{message}</div>}
        {error && <div className="message error">Error: {error}</div>}
      </form>
    </div>
  );
};

export default CreateLoadPage;


