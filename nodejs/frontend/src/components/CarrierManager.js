import React, { useState, useEffect } from 'react';
import { getCarriers, createCarrier, updateCarrier, deleteCarrier } from '../services/api';
import './CarrierManager.css';

const CarrierManager = () => {
  const [carriers, setCarriers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingCarrier, setEditingCarrier] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    aliases: '',
    billTo: {
      name: '',
      cityStateZip: '',
      phone: ''
    }
  });

  useEffect(() => {
    loadCarriers();
  }, []);

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

      if (editingCarrier) {
        await updateCarrier(editingCarrier._id, submitData);
      } else {
        await createCarrier(submitData);
      }
      
      setShowForm(false);
      setEditingCarrier(null);
      setFormData({
        name: '',
        aliases: '',
        billTo: {
          name: '',
          cityStateZip: '',
          phone: ''
        }
      });
      loadCarriers();
    } catch (error) {
      alert('Failed to save carrier: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleEdit = (carrier) => {
    setEditingCarrier(carrier);
    setFormData({
      name: carrier.name || '',
      aliases: carrier.aliases ? carrier.aliases.join(', ') : '',
      billTo: carrier.billTo || {
        name: '',
        cityStateZip: '',
        phone: ''
      }
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this carrier?')) {
      return;
    }
    try {
      await deleteCarrier(id);
      loadCarriers();
    } catch (error) {
      alert('Failed to delete carrier: ' + (error.response?.data?.error || error.message));
    }
  };

  return (
    <div className="carrier-manager">
      <div className="manager-header">
        <h3>Carriers</h3>
        <button onClick={() => {
          setShowForm(!showForm);
          if (showForm) {
            setEditingCarrier(null);
            setFormData({
              name: '',
              aliases: '',
              billTo: {
                name: '',
                cityStateZip: '',
                phone: ''
              }
            });
          }
        }} className="add-btn">
          {showForm ? 'Cancel' : '+ Add Carrier'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="carrier-form">
          <div className="form-group">
            <label>Carrier Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
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

          <div className="form-section">
            <h4>Bill To Information</h4>
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={formData.billTo.name}
                onChange={(e) => setFormData({
                  ...formData,
                  billTo: { ...formData.billTo, name: e.target.value }
                })}
              />
            </div>
            <div className="form-group">
              <label>City, State ZIP</label>
              <input
                type="text"
                value={formData.billTo.cityStateZip}
                onChange={(e) => setFormData({
                  ...formData,
                  billTo: { ...formData.billTo, cityStateZip: e.target.value }
                })}
              />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input
                type="text"
                value={formData.billTo.phone}
                onChange={(e) => setFormData({
                  ...formData,
                  billTo: { ...formData.billTo, phone: e.target.value }
                })}
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="submit">{editingCarrier ? 'Update' : 'Create'}</button>
            <button type="button" onClick={() => {
              setShowForm(false);
              setEditingCarrier(null);
            }}>Cancel</button>
          </div>
        </form>
      )}

      <div className="carriers-list">
        {carriers.map(carrier => (
          <div key={carrier._id} className="carrier-item">
            <div className="carrier-info">
              <strong>{carrier.name}</strong>
              {carrier.aliases && carrier.aliases.length > 0 && (
                <span className="aliases"> ({carrier.aliases.join(', ')})</span>
              )}
              {carrier.billTo && carrier.billTo.name && (
                <div className="bill-to-info">
                  <small>Bill To: {carrier.billTo.name}</small>
                </div>
              )}
            </div>
            <div className="carrier-actions">
              <button onClick={() => handleEdit(carrier)} className="edit-btn">Edit</button>
              <button onClick={() => handleDelete(carrier._id)} className="delete-btn">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CarrierManager;

