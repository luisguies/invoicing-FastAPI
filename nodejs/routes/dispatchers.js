const express = require('express');
const router = express.Router();
const { Dispatcher } = require('../db/database');

// Get all dispatchers
router.get('/', async (req, res) => {
  try {
    const dispatchers = await Dispatcher.find().sort({ created_at: -1 });
    res.json(dispatchers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get active dispatcher
router.get('/active', async (req, res) => {
  try {
    const dispatcher = await Dispatcher.findOne({ isActive: true });
    if (!dispatcher) {
      return res.status(404).json({ error: 'No active dispatcher found' });
    }
    res.json(dispatcher);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get dispatcher by ID
router.get('/:id', async (req, res) => {
  try {
    const dispatcher = await Dispatcher.findById(req.params.id);
    if (!dispatcher) {
      return res.status(404).json({ error: 'Dispatcher not found' });
    }
    res.json(dispatcher);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Validate parent_id: if set, must reference a main dispatcher (parent_id null)
async function validateParentId(parentId) {
  if (!parentId) return;
  const parent = await Dispatcher.findById(parentId);
  if (!parent) {
    throw new Error('Parent dispatcher not found');
  }
  if (parent.parent_id != null) {
    throw new Error('Parent must be a main dispatcher (not a sub-dispatcher)');
  }
}

// Create dispatcher
router.post('/', async (req, res) => {
  try {
    const { name, payableTo, isActive, parent_id } = req.body;

    await validateParentId(parent_id || null);

    // If setting as active, deactivate all other dispatchers
    if (isActive) {
      await Dispatcher.updateMany({}, { isActive: false });
    }

    const dispatcher = new Dispatcher({
      name,
      payableTo: payableTo || {},
      isActive: isActive || false,
      parent_id: parent_id || null
    });

    await dispatcher.save();
    res.status(201).json(dispatcher);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update dispatcher
router.put('/:id', async (req, res) => {
  try {
    const { name, payableTo, isActive, parent_id } = req.body;

    if (parent_id !== undefined) {
      await validateParentId(parent_id || null);
      if (parent_id && parent_id === req.params.id) {
        return res.status(400).json({ error: 'Dispatcher cannot be its own parent' });
      }
    }

    // If setting as active, deactivate all other dispatchers
    if (isActive) {
      await Dispatcher.updateMany(
        { _id: { $ne: req.params.id } },
        { isActive: false }
      );
    }

    const update = {
      name,
      payableTo: payableTo || {},
      isActive: isActive !== undefined ? isActive : false
    };
    if (parent_id !== undefined) {
      update.parent_id = parent_id || null;
    }

    const dispatcher = await Dispatcher.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    );

    if (!dispatcher) {
      return res.status(404).json({ error: 'Dispatcher not found' });
    }

    res.json(dispatcher);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set dispatcher as active
router.patch('/:id/activate', async (req, res) => {
  try {
    // Deactivate all dispatchers
    await Dispatcher.updateMany({}, { isActive: false });

    // Activate the specified dispatcher
    const dispatcher = await Dispatcher.findByIdAndUpdate(
      req.params.id,
      { isActive: true },
      { new: true }
    );

    if (!dispatcher) {
      return res.status(404).json({ error: 'Dispatcher not found' });
    }

    res.json(dispatcher);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete dispatcher
router.delete('/:id', async (req, res) => {
  try {
    const dispatcher = await Dispatcher.findByIdAndDelete(req.params.id);
    if (!dispatcher) {
      return res.status(404).json({ error: 'Dispatcher not found' });
    }
    res.json({ message: 'Dispatcher deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

