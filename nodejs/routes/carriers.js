const express = require('express');
const router = express.Router();
const { Carrier, Driver } = require('../db/database');

// Get all carriers
router.get('/', async (req, res) => {
  try {
    const carriers = await Carrier.find().populate('driver_ids', 'name aliases');
    res.json(carriers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get carrier by ID
router.get('/:id', async (req, res) => {
  try {
    const carrier = await Carrier.findById(req.params.id).populate('driver_ids', 'name aliases');
    if (!carrier) {
      return res.status(404).json({ error: 'Carrier not found' });
    }
    res.json(carrier);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new carrier
router.post('/', async (req, res) => {
  try {
    const { name, aliases, billTo } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Carrier name is required' });
    }

    const carrier = new Carrier({
      name: name.trim(),
      aliases: aliases || [],
      billTo: billTo || {}
    });

    await carrier.save();
    res.status(201).json(carrier);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ error: 'Carrier with this name already exists' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Update carrier
router.put('/:id', async (req, res) => {
  try {
    const { name, aliases, driver_ids, billTo } = req.body;
    
    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (aliases !== undefined) updateData.aliases = aliases;
    if (driver_ids !== undefined) updateData.driver_ids = driver_ids;
    if (billTo !== undefined) updateData.billTo = billTo;

    const carrier = await Carrier.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('driver_ids', 'name aliases');

    if (!carrier) {
      return res.status(404).json({ error: 'Carrier not found' });
    }

    res.json(carrier);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ error: 'Carrier with this name already exists' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Delete carrier
router.delete('/:id', async (req, res) => {
  try {
    const carrier = await Carrier.findByIdAndDelete(req.params.id);
    if (!carrier) {
      return res.status(404).json({ error: 'Carrier not found' });
    }

    // Remove carrier reference from drivers
    await Driver.updateMany(
      { carrier_id: req.params.id },
      { $unset: { carrier_id: 1 } }
    );

    res.json({ message: 'Carrier deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

