import React, { useState, useEffect } from 'react';
import { getDispatchers, getActiveDispatcher, createDispatcher, updateDispatcher, activateDispatcher, deleteDispatcher } from '../services/api';
import './DispatcherManager.css';

const DispatcherManager = () => {
  const [dispatchers, setDispatchers] = useState([]);
  const [activeDispatcher, setActiveDispatcher] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingDispatcher, setEditingDispatcher] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    payableTo: {
      name: '',
      cityStateZip: '',
      phone: ''
    },
    isActive: false,
    parent_id: ''
  });

  useEffect(() => {
    loadDispatchers();
    loadActiveDispatcher();
  }, []);

  const loadDispatchers = async () => {
    try {
      const data = await getDispatchers();
      setDispatchers(data);
    } catch (error) {
      console.error('Failed to load dispatchers:', error);
    }
  };

  const loadActiveDispatcher = async () => {
    try {
      const data = await getActiveDispatcher();
      setActiveDispatcher(data);
    } catch (error) {
      // No active dispatcher is okay
      setActiveDispatcher(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        parent_id: formData.parent_id || null
      };
      if (editingDispatcher) {
        await updateDispatcher(editingDispatcher._id, payload);
      } else {
        await createDispatcher(payload);
      }
      
      setShowForm(false);
      setEditingDispatcher(null);
      setFormData({
        name: '',
        payableTo: {
          name: '',
          cityStateZip: '',
          phone: ''
        },
        isActive: false,
        parent_id: ''
      });
      loadDispatchers();
      loadActiveDispatcher();
    } catch (error) {
      alert('Failed to save dispatcher: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleEdit = (dispatcher) => {
    setEditingDispatcher(dispatcher);
    const parentId = dispatcher.parent_id;
    setFormData({
      name: dispatcher.name || '',
      payableTo: dispatcher.payableTo || {
        name: '',
        cityStateZip: '',
        phone: ''
      },
      isActive: dispatcher.isActive || false,
      parent_id: parentId ? (typeof parentId === 'object' ? parentId._id : parentId) : ''
    });
    setShowForm(true);
  };

  const handleActivate = async (id) => {
    try {
      await activateDispatcher(id);
      loadDispatchers();
      loadActiveDispatcher();
    } catch (error) {
      alert('Failed to activate dispatcher: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this dispatcher?')) {
      return;
    }
    try {
      await deleteDispatcher(id);
      loadDispatchers();
      loadActiveDispatcher();
    } catch (error) {
      alert('Failed to delete dispatcher: ' + (error.response?.data?.error || error.message));
    }
  };

  return (
    <div className="dispatcher-manager">
      <div className="manager-header">
        <h3>Dispatchers</h3>
        <div>
          {activeDispatcher && (
            <span className="active-badge">Active: {activeDispatcher.name}</span>
          )}
          <button onClick={() => {
            setShowForm(!showForm);
            if (showForm) {
              setEditingDispatcher(null);
        setFormData({
        name: '',
        payableTo: {
          name: '',
          cityStateZip: '',
          phone: ''
        },
        isActive: false,
        parent_id: ''
      });
    }
  }} className="add-btn">
            {showForm ? 'Cancel' : '+ Add Dispatcher'}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="dispatcher-form">
          <div className="form-group">
            <label>Dispatcher Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="form-group">
            <label>Parent Dispatcher</label>
            <select
              value={formData.parent_id}
              onChange={(e) => setFormData({ ...formData, parent_id: e.target.value })}
            >
              <option value="">None (main dispatcher)</option>
              {dispatchers
                .filter(d => !d.parent_id && (!editingDispatcher || d._id !== editingDispatcher._id))
                .map(d => (
                  <option key={d._id} value={d._id}>{d.name}</option>
                ))}
            </select>
            <small>Leave as &quot;None&quot; for a main dispatcher; select one to create a sub-dispatcher.</small>
          </div>

          <div className="form-section">
            <h4>Payable To Information</h4>
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={formData.payableTo.name}
                onChange={(e) => setFormData({
                  ...formData,
                  payableTo: { ...formData.payableTo, name: e.target.value }
                })}
              />
            </div>
            <div className="form-group">
              <label>City, State ZIP</label>
              <input
                type="text"
                value={formData.payableTo.cityStateZip}
                onChange={(e) => setFormData({
                  ...formData,
                  payableTo: { ...formData.payableTo, cityStateZip: e.target.value }
                })}
              />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input
                type="text"
                value={formData.payableTo.phone}
                onChange={(e) => setFormData({
                  ...formData,
                  payableTo: { ...formData.payableTo, phone: e.target.value }
                })}
              />
            </div>
          </div>

          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              />
              Set as Active Dispatcher
            </label>
          </div>

          <div className="form-actions">
            <button type="submit">{editingDispatcher ? 'Update' : 'Create'}</button>
            <button type="button" onClick={() => {
              setShowForm(false);
              setEditingDispatcher(null);
            }}>Cancel</button>
          </div>
        </form>
      )}

      <div className="dispatchers-list">
        {(() => {
          const mainDispatchers = dispatchers.filter(d => !d.parent_id);
          const subDispatchers = dispatchers.filter(d => d.parent_id);
          const getMainId = (d) => (d.parent_id && (typeof d.parent_id === 'object' ? d.parent_id._id : d.parent_id)) || null;
          return (
            <>
              {mainDispatchers.map(main => (
                <React.Fragment key={main._id}>
                  <div className={`dispatcher-item dispatcher-item-main ${main.isActive ? 'active' : ''}`}>
                    <div className="dispatcher-info">
                      <strong>{main.name}</strong>
                      {main.isActive && <span className="active-badge">Active</span>}
                      {main.payableTo && main.payableTo.name && (
                        <div className="payable-to-info">
                          <small>Payable To: {main.payableTo.name}</small>
                        </div>
                      )}
                    </div>
                    <div className="dispatcher-actions">
                      {!main.isActive && (
                        <button onClick={() => handleActivate(main._id)} className="activate-btn">
                          Activate
                        </button>
                      )}
                      <button onClick={() => handleEdit(main)} className="edit-btn">Edit</button>
                      <button onClick={() => handleDelete(main._id)} className="delete-btn">Delete</button>
                    </div>
                  </div>
                  {subDispatchers
                    .filter(sub => getMainId(sub) && String(getMainId(sub)) === String(main._id))
                    .map(sub => (
                      <div key={sub._id} className={`dispatcher-item dispatcher-item-sub ${sub.isActive ? 'active' : ''}`}>
                        <div className="dispatcher-info">
                          <strong>{sub.name}</strong>
                          <span className="sub-under">Under: {main.name}</span>
                          {sub.isActive && <span className="active-badge">Active</span>}
                          {sub.payableTo && sub.payableTo.name && (
                            <div className="payable-to-info">
                              <small>Payable To: {sub.payableTo.name}</small>
                            </div>
                          )}
                        </div>
                        <div className="dispatcher-actions">
                          {!sub.isActive && (
                            <button onClick={() => handleActivate(sub._id)} className="activate-btn">
                              Activate
                            </button>
                          )}
                          <button onClick={() => handleEdit(sub)} className="edit-btn">Edit</button>
                          <button onClick={() => handleDelete(sub._id)} className="delete-btn">Delete</button>
                        </div>
                      </div>
                    ))}
                </React.Fragment>
              ))}
            </>
          );
        })()}
      </div>
    </div>
  );
};

export default DispatcherManager;

