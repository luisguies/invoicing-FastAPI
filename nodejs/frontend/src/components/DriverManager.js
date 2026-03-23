import React, { useState, useEffect } from 'react';
import { getDrivers, getCarriers, createDriver, updateDriver, deleteDriver } from '../services/api';
import './DriverManager.css';

const DriverManager = () => {
  const [drivers, setDrivers] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingDriver, setEditingDriver] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    aliases: '',
    groupLabel: '',
    carrier_id: '',
    color: ''
  });

  useEffect(() => {
    loadDrivers();
    loadCarriers();
  }, []);

  const loadDrivers = async () => {
    try {
      const data = await getDrivers();
      setDrivers(data);
    } catch (error) {
      console.error('Failed to load drivers:', error);
    }
  };

  const loadCarriers = async () => {
    try {
      const data = await getCarriers();
      setCarriers(data);
    } catch (error) {
      console.error('Failed to load carriers:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const submitData = {
        ...formData,
        aliases: formData.aliases ? formData.aliases.split(',').map(a => a.trim()).filter(a => a) : []
      };

      if (editingDriver) {
        await updateDriver(editingDriver._id, submitData);
      } else {
        await createDriver(submitData);
      }
      
      setShowForm(false);
      setEditingDriver(null);
      setFormData({
        name: '',
        aliases: '',
        groupLabel: '',
        carrier_id: '',
        color: ''
      });
      loadDrivers();
    } catch (error) {
      alert('Failed to save driver: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleEdit = (driver) => {
    setEditingDriver(driver);
    setFormData({
      name: driver.name || '',
      aliases: driver.aliases ? driver.aliases.join(', ') : '',
      groupLabel: driver.groupLabel || '',
      carrier_id: driver.carrier_id?._id || driver.carrier_id || '',
      color: driver.color || ''
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this driver?')) {
      return;
    }
    try {
      await deleteDriver(id);
      loadDrivers();
    } catch (error) {
      alert('Failed to delete driver: ' + (error.response?.data?.error || error.message));
    }
  };

  return (
    <div className="driver-manager">
      <div className="manager-header">
        <h3>Drivers</h3>
        <button onClick={() => {
          setShowForm(!showForm);
          if (showForm) {
            setEditingDriver(null);
            setFormData({
              name: '',
              aliases: '',
              groupLabel: '',
              carrier_id: '',
              color: ''
            });
          }
        }} className="add-btn">
          {showForm ? 'Cancel' : '+ Add Driver'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="driver-form">
          <div className="form-group">
            <label>Driver Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="form-group">
            <label>Group Label</label>
            <input
              type="text"
              value={formData.groupLabel}
              onChange={(e) => setFormData({ ...formData, groupLabel: e.target.value })}
              placeholder="Label used in invoice tables (defaults to driver name if empty)"
            />
          </div>

          <div className="form-group">
            <label>Aliases (comma-separated)</label>
            <input
              type="text"
              value={formData.aliases}
              onChange={(e) => setFormData({ ...formData, aliases: e.target.value })}
              placeholder="Alias1, Alias2, ..."
            />
          </div>

          <div className="form-group">
            <label>Carrier *</label>
            <select
              value={formData.carrier_id}
              onChange={(e) => setFormData({ ...formData, carrier_id: e.target.value })}
              required
            >
              <option value="">Select Carrier</option>
              {carriers.map(carrier => (
                <option key={carrier._id} value={carrier._id}>
                  {carrier.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Calendar Color</label>
            <div className="color-picker-container">
              <input
                type="color"
                value={formData.color || '#cccccc'}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="color-picker"
              />
              <input
                type="text"
                value={formData.color || ''}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                placeholder="#cccccc"
                className="color-input"
                pattern="^#[0-9A-Fa-f]{6}$"
              />
              <button
                type="button"
                onClick={() => setFormData({ ...formData, color: '' })}
                className="clear-color-btn"
                title="Clear color (use auto-generated)"
              >
                Clear
              </button>
            </div>
            <small className="form-help-text">Color used for this driver in the calendar view. Leave empty for auto-generated color.</small>
          </div>

          <div className="form-actions">
            <button type="submit">{editingDriver ? 'Update' : 'Create'}</button>
            <button type="button" onClick={() => {
              setShowForm(false);
              setEditingDriver(null);
            }}>Cancel</button>
          </div>
        </form>
      )}

      <div className="drivers-list">
        {drivers.map(driver => (
          <div key={driver._id} className="driver-item">
            <div className="driver-info">
              <div className="driver-name-row">
                {driver.color && (
                  <span 
                    className="driver-color-indicator" 
                    style={{ backgroundColor: driver.color }}
                    title={`Calendar color: ${driver.color}`}
                  ></span>
                )}
                <strong>{driver.name}</strong>
              </div>
              {driver.groupLabel && (
                <span className="group-label"> (Group: {driver.groupLabel})</span>
              )}
              {driver.aliases && driver.aliases.length > 0 && (
                <span className="aliases"> - Aliases: {driver.aliases.join(', ')}</span>
              )}
              {driver.carrier_id && (
                <div className="carrier-info">
                  <small>Carrier: {driver.carrier_id.name}</small>
                </div>
              )}
            </div>
            <div className="driver-actions">
              <button onClick={() => handleEdit(driver)} className="edit-btn">Edit</button>
              <button onClick={() => handleDelete(driver._id)} className="delete-btn">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DriverManager;

