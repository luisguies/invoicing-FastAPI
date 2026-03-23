import React, { useState, useEffect } from 'react';
import CarrierManager from '../components/CarrierManager';
import DriverManager from '../components/DriverManager';
import DispatcherManager from '../components/DispatcherManager';
import { getSettings, updateSettings } from '../services/api';
import './SettingsPage.css';

const SettingsPage = () => {
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState({
    defaultRate: 5.0,
    billTo: {
      name: '',
      cityStateZip: '',
      phone: ''
    },
    hideInvoicedLoads: false
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await getSettings();
      setSettings({
        defaultRate: data.defaultRate || 5.0,
        billTo: data.billTo || {
          name: '',
          cityStateZip: '',
          phone: ''
        },
        hideInvoicedLoads: data.hideInvoicedLoads !== undefined ? data.hideInvoicedLoads : false
      });
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await updateSettings(settings);
      alert('Settings saved successfully!');
    } catch (error) {
      alert('Failed to save settings: ' + (error.response?.data?.error || error.message));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading settings...</div>;
  }

  return (
    <div className="settings-page">
      <h2>Settings</h2>
      
      <div className="settings-tabs">
        <button
          className={activeTab === 'general' ? 'active' : ''}
          onClick={() => setActiveTab('general')}
        >
          General
        </button>
        <button
          className={activeTab === 'carriers' ? 'active' : ''}
          onClick={() => setActiveTab('carriers')}
        >
          Carriers
        </button>
        <button
          className={activeTab === 'drivers' ? 'active' : ''}
          onClick={() => setActiveTab('drivers')}
        >
          Drivers
        </button>
        <button
          className={activeTab === 'dispatchers' ? 'active' : ''}
          onClick={() => setActiveTab('dispatchers')}
        >
          Dispatchers
        </button>
      </div>

      <div className="settings-content">
        {activeTab === 'general' && (
          <div className="general-settings">
            <h3>General Settings</h3>
            
            <div className="settings-form">
              <div className="form-group">
                <label>Default Rate (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={settings.defaultRate}
                  onChange={(e) => setSettings({
                    ...settings,
                    defaultRate: parseFloat(e.target.value) || 0
                  })}
                  placeholder="5.0"
                />
                <small>Default commission rate used for invoice generation</small>
              </div>

              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.hideInvoicedLoads}
                    onChange={(e) => setSettings({
                      ...settings,
                      hideInvoicedLoads: e.target.checked
                    })}
                  />
                  Hide invoiced loads
                </label>
                <small>When enabled, invoiced loads will be hidden from the main loads list</small>
              </div>

              <div className="form-section">
                <h4>Bill To Information</h4>
                <div className="form-group">
                  <label>Name</label>
                  <input
                    type="text"
                    value={settings.billTo.name}
                    onChange={(e) => setSettings({
                      ...settings,
                      billTo: { ...settings.billTo, name: e.target.value }
                    })}
                    placeholder="Company Name"
                  />
                </div>
                <div className="form-group">
                  <label>City, State ZIP</label>
                  <input
                    type="text"
                    value={settings.billTo.cityStateZip}
                    onChange={(e) => setSettings({
                      ...settings,
                      billTo: { ...settings.billTo, cityStateZip: e.target.value }
                    })}
                    placeholder="City, State ZIP"
                  />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    type="text"
                    value={settings.billTo.phone}
                    onChange={(e) => setSettings({
                      ...settings,
                      billTo: { ...settings.billTo, phone: e.target.value }
                    })}
                    placeholder="Phone Number"
                  />
                </div>
              </div>

              <div className="form-actions">
                <button onClick={handleSaveSettings} disabled={saving} className="save-btn">
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'carriers' && <CarrierManager />}
        {activeTab === 'drivers' && <DriverManager />}
        {activeTab === 'dispatchers' && <DispatcherManager />}
      </div>
    </div>
  );
};

export default SettingsPage;

