import React, { useState, useEffect } from 'react';
import { getRules, createRule, updateRule, deleteRule, getCarriers } from '../services/api';
import { formatDateInput } from '../utils/dateUtils';
import './InvoiceRules.css';

const InvoiceRules = ({ onRuleSelect }) => {
  const [rules, setRules] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [formData, setFormData] = useState({
    rule_name: '',
    earliest_pickup_date: '',
    latest_delivery_date: '',
    carrier_id: ''
  });

  useEffect(() => {
    loadRules();
    loadCarriers();
  }, []);

  const loadRules = async () => {
    try {
      const data = await getRules();
      setRules(data);
    } catch (error) {
      console.error('Failed to load rules:', error);
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
      if (editingRule) {
        await updateRule(editingRule._id, formData);
      } else {
        await createRule(formData);
      }
      setShowForm(false);
      setEditingRule(null);
      setFormData({
        rule_name: '',
        earliest_pickup_date: '',
        latest_delivery_date: '',
        carrier_id: ''
      });
      loadRules();
    } catch (error) {
      alert('Failed to save rule: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setFormData({
      rule_name: rule.rule_name,
      earliest_pickup_date: rule.earliest_pickup_date ? formatDateInput(rule.earliest_pickup_date) : '',
      latest_delivery_date: rule.latest_delivery_date ? formatDateInput(rule.latest_delivery_date) : '',
      carrier_id: rule.carrier_id?._id || ''
    });
    setShowForm(true);
  };

  const handleDelete = async (ruleId) => {
    if (!window.confirm('Are you sure you want to delete this rule?')) {
      return;
    }
    try {
      await deleteRule(ruleId);
      loadRules();
    } catch (error) {
      alert('Failed to delete rule: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleSelect = (rule) => {
    if (onRuleSelect) {
      onRuleSelect(rule);
    }
  };

  return (
    <div className="invoice-rules">
      <div className="rules-header">
        <h3>Invoice Rules</h3>
        <button onClick={() => setShowForm(!showForm)} className="add-btn">
          {showForm ? 'Cancel' : '+ Add Rule'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rule-form">
          <div className="form-group">
            <label>Rule Name</label>
            <input
              type="text"
              value={formData.rule_name}
              onChange={(e) => setFormData({ ...formData, rule_name: e.target.value })}
              required
            />
          </div>

          <div className="form-group">
            <label>Earliest Pickup Date</label>
            <input
              type="date"
              value={formData.earliest_pickup_date}
              onChange={(e) => setFormData({ ...formData, earliest_pickup_date: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>Latest Delivery Date</label>
            <input
              type="date"
              value={formData.latest_delivery_date}
              onChange={(e) => setFormData({ ...formData, latest_delivery_date: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>Carrier (Optional)</label>
            <select
              value={formData.carrier_id}
              onChange={(e) => setFormData({ ...formData, carrier_id: e.target.value })}
            >
              <option value="">All Carriers</option>
              {carriers.map(carrier => (
                <option key={carrier._id} value={carrier._id}>
                  {carrier.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-actions">
            <button type="submit" className="save-btn">
              {editingRule ? 'Update' : 'Create'} Rule
            </button>
            <button type="button" onClick={() => {
              setShowForm(false);
              setEditingRule(null);
              setFormData({
                rule_name: '',
                earliest_pickup_date: '',
                latest_delivery_date: '',
                carrier_id: ''
              });
            }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="rules-list">
        {rules.length === 0 ? (
          <p className="no-rules">No rules created yet.</p>
        ) : (
          rules.map(rule => (
            <div key={rule._id} className="rule-item">
              <div className="rule-info">
                <h4>{rule.rule_name}</h4>
                <div className="rule-details">
                  {rule.earliest_pickup_date && (
                    <span>From: {new Date(rule.earliest_pickup_date).toLocaleDateString()}</span>
                  )}
                  {rule.latest_delivery_date && (
                    <span>To: {new Date(rule.latest_delivery_date).toLocaleDateString()}</span>
                  )}
                  {rule.carrier_id && (
                    <span>Carrier: {rule.carrier_id.name}</span>
                  )}
                </div>
              </div>
              <div className="rule-actions">
                <button onClick={() => handleSelect(rule)} className="select-btn">
                  Use
                </button>
                <button onClick={() => handleEdit(rule)} className="edit-btn">
                  Edit
                </button>
                <button onClick={() => handleDelete(rule._id)} className="delete-btn">
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default InvoiceRules;

