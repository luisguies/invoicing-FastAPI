const express = require('express');
const router = express.Router();
const { Driver, Carrier } = require('../db/database');

// Get all drivers (optionally filtered by carrier)
router.get('/', async (req, res) => {
  try {
    const { carrier_id } = req.query;

    const query = {};
    if (carrier_id) {
      query.carrier_id = carrier_id;
    }

    const drivers = await Driver.find(query)
      .populate('carrier_id', 'name aliases')
      .sort({ name: 1 });
    res.json(drivers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get driver by ID
router.get('/:id', async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id).populate('carrier_id', 'name aliases');
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    res.json(driver);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new driver
router.post('/', async (req, res) => {
  try {
    const { name, aliases, carrier_id, groupLabel, color } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Driver name is required' });
    }

    if (!carrier_id) {
      return res.status(400).json({ error: 'Carrier ID is required' });
    }

    // Verify carrier exists
    const carrier = await Carrier.findById(carrier_id);
    if (!carrier) {
      return res.status(404).json({ error: 'Carrier not found' });
    }

    const driver = new Driver({
      name: name.trim(),
      aliases: aliases || [],
      carrier_id: carrier_id,
      groupLabel: groupLabel ? groupLabel.trim() : undefined,
      color: color ? color.trim() : undefined
    });

    await driver.save();

    // Add driver to carrier's driver_ids array
    await Carrier.findByIdAndUpdate(carrier_id, {
      $addToSet: { driver_ids: driver._id }
    });

    const populatedDriver = await Driver.findById(driver._id).populate('carrier_id', 'name aliases');
    res.status(201).json(populatedDriver);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update driver
router.put('/:id', async (req, res) => {
  try {
    const { name, aliases, carrier_id, groupLabel, color } = req.body;
    
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (aliases !== undefined) updateData.aliases = aliases;
    if (groupLabel !== undefined) updateData.groupLabel = groupLabel ? groupLabel.trim() : undefined;
    if (color !== undefined) updateData.color = color ? color.trim() : null;
    
    if (carrier_id !== undefined) {
      // Verify new carrier exists
      const carrier = await Carrier.findById(carrier_id);
      if (!carrier) {
        return res.status(404).json({ error: 'Carrier not found' });
      }

      // Remove driver from old carrier's driver_ids
      if (driver.carrier_id) {
        await Carrier.findByIdAndUpdate(driver.carrier_id, {
          $pull: { driver_ids: driver._id }
        });
      }

      // Add driver to new carrier's driver_ids
      updateData.carrier_id = carrier_id;
      await Carrier.findByIdAndUpdate(carrier_id, {
        $addToSet: { driver_ids: driver._id }
      });
    }

    const updatedDriver = await Driver.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('carrier_id', 'name aliases');

    res.json(updatedDriver);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete driver
router.delete('/:id', async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    // Remove driver from carrier's driver_ids array
    if (driver.carrier_id) {
      await Carrier.findByIdAndUpdate(driver.carrier_id, {
        $pull: { driver_ids: driver._id }
      });
    }

    await Driver.findByIdAndDelete(req.params.id);
    res.json({ message: 'Driver deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

