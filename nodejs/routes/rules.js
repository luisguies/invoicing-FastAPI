const express = require('express');
const router = express.Router();
const { InvoiceRule } = require('../db/database');

// Get all rules (ensure "default" rule exists for dynamic date range)
router.get('/', async (req, res) => {
  try {
    let rules = await InvoiceRule.find()
      .populate('carrier_id', 'name aliases')
      .sort({ created_at: -1 });

    const hasDefault = rules.some(r => r.rule_name && r.rule_name.toLowerCase() === 'default');
    if (!hasDefault) {
      const defaultRule = new InvoiceRule({
        rule_name: 'default',
        earliest_pickup_date: null,
        latest_delivery_date: null,
        carrier_id: null
      });
      await defaultRule.save();
      const populated = await InvoiceRule.findById(defaultRule._id)
        .populate('carrier_id', 'name aliases');
      rules = [populated, ...rules];
    }

    res.json(rules);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get rule by ID
router.get('/:id', async (req, res) => {
  try {
    const rule = await InvoiceRule.findById(req.params.id)
      .populate('carrier_id', 'name aliases');
    
    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    res.json(rule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new rule
router.post('/', async (req, res) => {
  try {
    const { rule_name, earliest_pickup_date, latest_delivery_date, carrier_id } = req.body;
    
    if (!rule_name) {
      return res.status(400).json({ error: 'Rule name is required' });
    }

    const rule = new InvoiceRule({
      rule_name: rule_name.trim(),
      earliest_pickup_date: earliest_pickup_date ? new Date(earliest_pickup_date) : null,
      latest_delivery_date: latest_delivery_date ? new Date(latest_delivery_date) : null,
      carrier_id: carrier_id || null
    });

    await rule.save();
    
    const populatedRule = await InvoiceRule.findById(rule._id)
      .populate('carrier_id', 'name aliases');

    res.status(201).json(populatedRule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update rule
router.put('/:id', async (req, res) => {
  try {
    const { rule_name, earliest_pickup_date, latest_delivery_date, carrier_id } = req.body;
    
    const updateData = {};
    if (rule_name !== undefined) updateData.rule_name = rule_name.trim();
    if (earliest_pickup_date !== undefined) {
      updateData.earliest_pickup_date = earliest_pickup_date ? new Date(earliest_pickup_date) : null;
    }
    if (latest_delivery_date !== undefined) {
      updateData.latest_delivery_date = latest_delivery_date ? new Date(latest_delivery_date) : null;
    }
    if (carrier_id !== undefined) updateData.carrier_id = carrier_id || null;

    const rule = await InvoiceRule.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('carrier_id', 'name aliases');

    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    res.json(rule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete rule
router.delete('/:id', async (req, res) => {
  try {
    const rule = await InvoiceRule.findByIdAndDelete(req.params.id);
    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    res.json({ message: 'Rule deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

