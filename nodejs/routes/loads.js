const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { Load } = require('../db/database');
const { checkAndUpdateConflicts, removeFromConflictLists } = require('../services/loadConflictService');
const { recalculateDriverConflictsForDriver, checkAndUpdateDriverConflictsForLoad } = require('../services/driverConflictService');
const { recalculateDuplicateConflictsForCarrierLoadNumber, checkAndUpdateDuplicateConflictsForLoad } = require('../services/duplicateLoadConflictService');
const { refreshConflictsForLoads } = require('../services/conflictRefreshService');
const { createCarrierAlias } = require('../services/carrierResolutionService');
const { computeInvoiceWeekFields } = require('../services/invoiceWeekService');

function safeLower(s) {
  return (s || '').toString().toLowerCase();
}

function deriveRateConfirmationPath(loadData) {
  const explicitPath = (loadData?.rate_confirmation_path || '').toString().trim();
  return explicitPath ? explicitPath.replace(/\\/g, '/') : null;
}

function toAbsoluteRateConfirmationPath(rateConfirmationPath) {
  const normalized = (rateConfirmationPath || '').toString().replace(/\\/g, '/').trim();
  if (!normalized) return null;
  if (normalized.includes('..')) return null;
  if (!normalized.startsWith('uploads/')) return null;
  return path.join('/app', normalized);
}

function compareCarrierGroups(a, b) {
  const aUnassigned = !a?.carrier?._id;
  const bUnassigned = !b?.carrier?._id;
  if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1; // unassigned last

  const aName = safeLower(a?.carrier?.name);
  const bName = safeLower(b?.carrier?.name);
  if (aName && bName && aName !== bName) return aName.localeCompare(bName);

  const aId = a?.carrier?._id ? a.carrier._id.toString() : '';
  const bId = b?.carrier?._id ? b.carrier._id.toString() : '';
  return aId.localeCompare(bId);
}

function compareLoadsByDriverName(a, b) {
  const aAssigned = !!a?.driver_id;
  const bAssigned = !!b?.driver_id;
  if (aAssigned !== bAssigned) return aAssigned ? -1 : 1; // assigned first

  const aDriverName = safeLower(a?.driver_id?.name);
  const bDriverName = safeLower(b?.driver_id?.name);
  if (aDriverName !== bDriverName) return aDriverName.localeCompare(bDriverName);

  // deterministic fallback to keep refresh ordering stable
  const aPickup = a?.pickup_date ? new Date(a.pickup_date).getTime() : 0;
  const bPickup = b?.pickup_date ? new Date(b.pickup_date).getTime() : 0;
  if (aPickup !== bPickup) return aPickup - bPickup;

  const aLoadNum = safeLower(a?.load_number);
  const bLoadNum = safeLower(b?.load_number);
  return aLoadNum.localeCompare(bLoadNum);
}

// Get all loads (with optional filters)
router.get('/', async (req, res) => {
  try {
    const { carrier_id, driver_id, cancelled, confirmed, invoiced } = req.query;
    
    const query = {};
    if (carrier_id) query.carrier_id = carrier_id;
    if (driver_id) query.driver_id = driver_id;
    if (cancelled !== undefined) query.cancelled = cancelled === 'true';
    if (confirmed !== undefined) query.confirmed = confirmed === 'true';
    
    // Always exclude invoiced loads from normal loads list unless explicitly requested
    // Invoiced loads should only appear in the /loads/invoiced endpoint
    // Only exclude loads where invoiced is explicitly true
    if (invoiced !== undefined) {
      query.invoiced = invoiced === 'true';
    } else {
      query.invoiced = { $ne: true }; // Exclude only loads where invoiced is true
    }

    // Ensure conflict flags are up-to-date on refresh (informational only; never blocks).
    try {
      const seedLoads = await Load.find(query).select('_id driver_id carrier_id load_number');
      await refreshConflictsForLoads(seedLoads);
    } catch (e) {
      console.error('Conflict refresh failed (GET /loads):', e);
    }

    const loads = await Load.find(query)
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases')
      .populate('date_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('driver_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('duplicate_conflict_ids', 'load_number pickup_date delivery_date')
      .sort({ created_at: -1 });

    res.json(loads);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search invoiced loads
router.get('/invoiced', async (req, res) => {
  try {
    const { carrier_id, load_number, driver_id, pickup_date_from, delivery_date_to, sub_dispatcher_id } = req.query;
    
    const query = { invoiced: true }; // Only search invoiced loads
    
    if (carrier_id) {
      query.carrier_id = carrier_id;
    }
    
    if (sub_dispatcher_id) {
      query.sub_dispatcher_id = sub_dispatcher_id;
    }
    
    if (load_number) {
      // Case-insensitive partial match for load number
      query.load_number = { $regex: load_number, $options: 'i' };
    }
    
    if (driver_id) {
      query.driver_id = driver_id;
    }
    
    // Filter by pickup date (loads picked up from this date onwards)
    if (pickup_date_from) {
      const pickupFromDate = new Date(pickup_date_from);
      pickupFromDate.setHours(0, 0, 0, 0);
      query.pickup_date = { $gte: pickupFromDate };
    }
    
    // Filter by delivery date (loads delivered on or before this date)
    if (delivery_date_to) {
      const deliveryToDate = new Date(delivery_date_to);
      deliveryToDate.setHours(23, 59, 59, 999); // End of day
      query.delivery_date = { $lte: deliveryToDate };
    }

    // Ensure conflict flags are up-to-date on refresh (informational only; never blocks).
    try {
      const seedLoads = await Load.find(query).select('_id driver_id carrier_id load_number');
      await refreshConflictsForLoads(seedLoads);
    } catch (e) {
      console.error('Conflict refresh failed (GET /loads/invoiced):', e);
    }

    const loads = await Load.find(query)
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases')
      .populate('sub_dispatcher_id', 'name parent_id')
      .populate('date_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('driver_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('duplicate_conflict_ids', 'load_number pickup_date delivery_date')
      .sort({ created_at: -1 });

    res.json(loads);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get loads grouped by carrier
router.get('/grouped', async (req, res) => {
  try {
    const { cancelled, invoiced } = req.query;
    
    const query = { 
      cancelled: false // Always exclude cancelled loads from grouped view
    };
    
    if (cancelled === 'true') {
      // If user wants cancelled, show all
      delete query.cancelled;
    }
    
    // Include invoiced loads by default (for calendar view)
    // Only filter if explicitly requested
    if (invoiced !== undefined) {
      if (invoiced === 'true') {
        // User explicitly wants only invoiced loads
        query.invoiced = true;
      } else if (invoiced === 'false') {
        // User explicitly doesn't want invoiced loads
        query.invoiced = { $ne: true };
      }
      // If invoiced is any other value, include all loads
    }

    // Ensure conflict flags are up-to-date on refresh (informational only; never blocks).
    try {
      const seedLoads = await Load.find(query).select('_id driver_id carrier_id load_number');
      await refreshConflictsForLoads(seedLoads);
    } catch (e) {
      console.error('Conflict refresh failed (GET /loads/grouped):', e);
    }

    const loads = await Load.find(query)
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases')
      .populate('date_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('driver_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('duplicate_conflict_ids', 'load_number pickup_date delivery_date')
      .sort({ carrier_id: 1, pickup_date: 1 });

    // Group by carrier
    const grouped = {};
    const unassignedLoads = [];
    
    for (const load of loads) {
      if (load.carrier_id) {
        const carrierId = load.carrier_id._id.toString();
        if (!grouped[carrierId]) {
          grouped[carrierId] = {
            carrier: load.carrier_id,
            loads: []
          };
        }
        grouped[carrierId].loads.push(load);
      } else {
        // Loads without carrier go to unassigned group
        unassignedLoads.push(load);
      }
    }

    const result = Object.values(grouped);
    
    // Add unassigned loads group if there are any
    if (unassignedLoads.length > 0) {
      result.push({
        carrier: {
          _id: null,
          name: 'Unassigned Carriers',
          aliases: []
        },
        loads: unassignedLoads
      });
    }

    // Default sorting:
    // - groups by carrier name/id
    // - loads within group by assigned driver name (assigned first, UNASSIGNED last)
    result.sort(compareCarrierGroups);
    for (const group of result) {
      if (Array.isArray(group.loads)) {
        group.loads.sort(compareLoadsByDriverName);
      }
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get loads log for a company between dates (all loads including invoiced)
router.get('/log', async (req, res) => {
  try {
    const { carrier_id, date_from, date_to } = req.query;
    if (!carrier_id) {
      return res.status(400).json({ error: 'carrier_id is required' });
    }
    const query = { carrier_id };
    if (date_from) {
      const from = new Date(date_from);
      from.setUTCHours(0, 0, 0, 0);
      query.pickup_date = query.pickup_date || {};
      query.pickup_date.$gte = from;
    }
    if (date_to) {
      const to = new Date(date_to);
      to.setUTCHours(23, 59, 59, 999);
      query.pickup_date = query.pickup_date || {};
      query.pickup_date.$lte = to;
    }
    const loads = await Load.find(query)
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases')
      .sort({ pickup_date: 1 });
    res.json(loads);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get sub-dispatcher report loads between dates
router.get('/sub-dispatcher-report', async (req, res) => {
  try {
    const { sub_dispatcher_id, date_from, date_to } = req.query;

    if (!sub_dispatcher_id) {
      return res.status(400).json({ error: 'sub_dispatcher_id is required' });
    }

    const query = {
      sub_dispatcher_id
    };

    if (date_from) {
      const from = new Date(date_from);
      from.setUTCHours(0, 0, 0, 0);
      query.pickup_date = query.pickup_date || {};
      query.pickup_date.$gte = from;
    }

    if (date_to) {
      const to = new Date(date_to);
      to.setUTCHours(23, 59, 59, 999);
      query.pickup_date = query.pickup_date || {};
      query.pickup_date.$lte = to;
    }

    const loads = await Load.find(query)
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases')
      .populate('sub_dispatcher_id', 'name parent_id')
      .sort({ pickup_date: 1 });

    const totalAmount = loads.reduce((sum, load) => sum + (Number(load.carrier_pay) || 0), 0);

    res.json({
      loads,
      totalAmount,
      totalLoads: loads.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get load by ID
router.get('/:id', async (req, res) => {
  try {
    const load = await Load.findById(req.params.id)
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases')
      .populate('date_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('driver_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('duplicate_conflict_ids', 'load_number pickup_date delivery_date');
    
    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }
    res.json(load);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get conflicting loads for a specific load
router.get('/:id/conflicts', async (req, res) => {
  try {
    const load = await Load.findById(req.params.id)
      .populate('date_conflict_ids', 'load_number pickup_date delivery_date carrier_id driver_id');
    
    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    const conflicts = await Load.find({ _id: { $in: load.date_conflict_ids } })
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases');

    res.json(conflicts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new load
router.post('/', async (req, res) => {
  try {
    const loadData = req.body;
    loadData.rate_confirmation_path = deriveRateConfirmationPath(loadData);

    // Auto-assign invoice fields if we have both dates.
    if (loadData?.pickup_date && loadData?.delivery_date) {
      const invoiceFields = computeInvoiceWeekFields(loadData.pickup_date, loadData.delivery_date);
      if (invoiceFields) {
        loadData.invoice_monday = invoiceFields.invoiceMonday;
        loadData.invoice_week_id = invoiceFields.invoiceWeekId;
      }
    }
    
    const load = new Load(loadData);
    await load.save();

    // Check for conflicts
    if (load.pickup_date && load.delivery_date) {
      await checkAndUpdateConflicts(
        load._id,
        load.pickup_date,
        load.delivery_date,
        load.driver_id
      );
    }

    // Driver conflicts are informational only; never block create.
    if (load.driver_id && load.pickup_date && load.delivery_date) {
      try {
        await recalculateDriverConflictsForDriver(load.driver_id);
      } catch (e) {
        console.error('Driver conflict recalculation failed (create):', e);
      }
    } else {
      // Ensure field is present/clean for unassigned drivers.
      try {
        await checkAndUpdateDriverConflictsForLoad(load._id, load.pickup_date, load.delivery_date, load.driver_id);
      } catch (e) {
        console.error('Driver conflict update failed (create):', e);
      }
    }

    // Duplicate load number conflicts (same carrier + load_number) are informational only.
    if (load.carrier_id && load.load_number) {
      try {
        await recalculateDuplicateConflictsForCarrierLoadNumber(load.carrier_id, load.load_number);
      } catch (e) {
        console.error('Duplicate conflict recalculation failed (create):', e);
      }
    } else {
      try {
        await checkAndUpdateDuplicateConflictsForLoad(load._id, load.carrier_id, load.load_number);
      } catch (e) {
        console.error('Duplicate conflict update failed (create):', e);
      }
    }

    const populatedLoad = await Load.findById(load._id)
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases')
      .populate('date_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('driver_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('duplicate_conflict_ids', 'load_number pickup_date delivery_date');

    res.status(201).json(populatedLoad);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// View load rate confirmation PDF
router.get('/:id/rate-confirmation', async (req, res) => {
  try {
    const load = await Load.findById(req.params.id).select('rate_confirmation_path');
    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    const absolutePath = toAbsoluteRateConfirmationPath(load.rate_confirmation_path);
    if (!absolutePath) {
      return res.status(404).json({ error: 'Rate confirmation path not available' });
    }

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'Rate confirmation file not found' });
    }

    return res.sendFile(absolutePath, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline'
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Update load
router.put('/:id', async (req, res) => {
  try {
    const load = await Load.findById(req.params.id);
    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    // Store old dates for conflict re-check
    const oldPickupDate = load.pickup_date;
    const oldDeliveryDate = load.delivery_date;
    const oldDriverId = load.driver_id;
    const oldCarrierId = load.carrier_id;
    const oldLoadNumber = load.load_number;

    // Update load
    Object.assign(load, req.body);

    // Auto-recompute invoice fields if we have both dates after update.
    if (load.pickup_date && load.delivery_date) {
      const invoiceFields = computeInvoiceWeekFields(load.pickup_date, load.delivery_date);
      if (invoiceFields) {
        load.invoice_monday = invoiceFields.invoiceMonday;
        load.invoice_week_id = invoiceFields.invoiceWeekId;
      }
    }
    await load.save();

    // Re-check conflicts if dates or driver changed
    if (
      (load.pickup_date && load.pickup_date.getTime() !== oldPickupDate?.getTime()) ||
      (load.delivery_date && load.delivery_date.getTime() !== oldDeliveryDate?.getTime()) ||
      (load.driver_id?.toString() !== oldDriverId?.toString())
    ) {
      if (load.pickup_date && load.delivery_date) {
        await checkAndUpdateConflicts(
          load._id,
          load.pickup_date,
          load.delivery_date,
          load.driver_id
        );
      }

      // Driver conflicts: strict overlap, same driver only, informational.
      const oldDriverStr = oldDriverId ? oldDriverId.toString() : null;
      const newDriverStr = load.driver_id ? load.driver_id.toString() : null;
      try {
        if (oldDriverStr && oldDriverStr !== newDriverStr) {
          await recalculateDriverConflictsForDriver(oldDriverId);
        }
        if (newDriverStr) {
          await recalculateDriverConflictsForDriver(load.driver_id);
        } else {
          await checkAndUpdateDriverConflictsForLoad(load._id, load.pickup_date, load.delivery_date, null);
        }
      } catch (e) {
        console.error('Driver conflict recalculation failed (update):', e);
      }
    }

    // Duplicate conflicts if carrier or load_number changed (informational only).
    if (
      (load.carrier_id?.toString() !== oldCarrierId?.toString()) ||
      ((load.load_number || '').toString() !== (oldLoadNumber || '').toString())
    ) {
      try {
        if (oldCarrierId && oldLoadNumber) {
          await recalculateDuplicateConflictsForCarrierLoadNumber(oldCarrierId, oldLoadNumber);
        }
        if (load.carrier_id && load.load_number) {
          await recalculateDuplicateConflictsForCarrierLoadNumber(load.carrier_id, load.load_number);
        } else {
          await checkAndUpdateDuplicateConflictsForLoad(load._id, load.carrier_id, load.load_number);
        }
      } catch (e) {
        console.error('Duplicate conflict recalculation failed (update):', e);
      }
    }

    const populatedLoad = await Load.findById(load._id)
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases')
      .populate('date_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('driver_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('duplicate_conflict_ids', 'load_number pickup_date delivery_date');

    res.json(populatedLoad);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Patch load (driver assignment only)
// PATCH /api/loads/:id
// body: { driver_id } where driver_id can be a Driver ObjectId or null
router.patch('/:id', async (req, res) => {
  try {
    if (!Object.prototype.hasOwnProperty.call(req.body, 'driver_id')) {
      return res.status(400).json({ error: 'driver_id is required (can be null)' });
    }

    const load = await Load.findById(req.params.id);
    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    const oldDriverId = load.driver_id;
    const newDriverId = req.body.driver_id === null ? null : req.body.driver_id;

    load.driver_id = newDriverId;
    await load.save();

    // Re-check conflicts if driver changed
    if (load.driver_id?.toString() !== oldDriverId?.toString()) {
      if (load.pickup_date && load.delivery_date) {
        await checkAndUpdateConflicts(
          load._id,
          load.pickup_date,
          load.delivery_date,
          load.driver_id
        );
      }

      // Driver conflicts: informational only; never reject assignment.
      try {
        if (oldDriverId) {
          await recalculateDriverConflictsForDriver(oldDriverId);
        }
        if (load.driver_id) {
          await recalculateDriverConflictsForDriver(load.driver_id);
        } else {
          await checkAndUpdateDriverConflictsForLoad(load._id, load.pickup_date, load.delivery_date, null);
        }
      } catch (e) {
        console.error('Driver conflict recalculation failed (patch driver):', e);
      }
    }

    const populatedLoad = await Load.findById(load._id)
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases')
      .populate('date_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('driver_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('duplicate_conflict_ids', 'load_number pickup_date delivery_date');

    res.json(populatedLoad);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark load as cancelled/uncancelled
router.patch('/:id/cancel', async (req, res) => {
  try {
    const { cancelled } = req.body;
    
    const load = await Load.findById(req.params.id);
    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    const oldDriverId = load.driver_id;
    const oldCarrierId = load.carrier_id;
    const oldLoadNumber = load.load_number;

    load.cancelled = cancelled !== undefined ? cancelled : !load.cancelled;
    await load.save();

    // If cancelling, remove from other loads' conflict lists
    if (load.cancelled) {
      await removeFromConflictLists(load._id);
      load.date_conflict_ids = [];
      await load.save();

      // Keep driver/duplicate warnings consistent for other loads (informational only).
      try {
        if (oldDriverId) await recalculateDriverConflictsForDriver(oldDriverId);
      } catch (e) {
        console.error('Driver conflict recalculation failed (cancel):', e);
      }
      try {
        if (oldCarrierId && oldLoadNumber) {
          await recalculateDuplicateConflictsForCarrierLoadNumber(oldCarrierId, oldLoadNumber);
        }
      } catch (e) {
        console.error('Duplicate conflict recalculation failed (cancel):', e);
      }

      // Clear warnings on the cancelled load itself.
      try {
        await checkAndUpdateDriverConflictsForLoad(load._id, load.pickup_date, load.delivery_date, null);
      } catch (e) {
        console.error('Driver conflict clear failed (cancel):', e);
      }
      try {
        await checkAndUpdateDuplicateConflictsForLoad(load._id, null, null);
      } catch (e) {
        console.error('Duplicate conflict clear failed (cancel):', e);
      }
    } else {
      // If uncancelling, re-check conflicts
      if (load.pickup_date && load.delivery_date) {
        await checkAndUpdateConflicts(
          load._id,
          load.pickup_date,
          load.delivery_date,
          load.driver_id
        );
      }

      try {
        if (load.driver_id) await recalculateDriverConflictsForDriver(load.driver_id);
      } catch (e) {
        console.error('Driver conflict recalculation failed (uncancel):', e);
      }

      try {
        if (load.carrier_id && load.load_number) {
          await recalculateDuplicateConflictsForCarrierLoadNumber(load.carrier_id, load.load_number);
        }
      } catch (e) {
        console.error('Duplicate conflict recalculation failed (uncancel):', e);
      }
    }

    const populatedLoad = await Load.findById(load._id)
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases')
      .populate('date_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('driver_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('duplicate_conflict_ids', 'load_number pickup_date delivery_date');

    res.json(populatedLoad);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Confirm load (required for loads with conflicts)
router.patch('/:id/confirm', async (req, res) => {
  try {
    const load = await Load.findById(req.params.id);
    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    load.confirmed = true;
    await load.save();

    const populatedLoad = await Load.findById(load._id)
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases')
      .populate('date_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('driver_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('duplicate_conflict_ids', 'load_number pickup_date delivery_date');

    res.json(populatedLoad);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark load as invoiced/uninvoiced
router.patch('/:id/invoiced', async (req, res) => {
  try {
    const { invoiced } = req.body;
    
    if (invoiced === undefined) {
      return res.status(400).json({ error: 'invoiced field is required' });
    }
    
    const load = await Load.findById(req.params.id);
    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    load.invoiced = invoiced === true;
    await load.save();

    const populatedLoad = await Load.findById(load._id)
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases')
      .populate('sub_dispatcher_id', 'name parent_id')
      .populate('date_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('driver_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('duplicate_conflict_ids', 'load_number pickup_date delivery_date');

    res.json(populatedLoad);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set load sub-dispatcher
router.patch('/:id/sub-dispatcher', async (req, res) => {
  try {
    const { sub_dispatcher_id } = req.body;
    
    const load = await Load.findById(req.params.id);
    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    load.sub_dispatcher_id = sub_dispatcher_id || null;
    await load.save();

    const populatedLoad = await Load.findById(load._id)
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases')
      .populate('sub_dispatcher_id', 'name parent_id')
      .populate('date_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('driver_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('duplicate_conflict_ids', 'load_number pickup_date delivery_date');

    res.json(populatedLoad);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update load carrier (with optional alias creation)
router.patch('/:id/carrier', async (req, res) => {
  try {
    const { carrier_id, save_alias } = req.body;
    
    if (!carrier_id) {
      return res.status(400).json({ error: 'carrier_id is required' });
    }

    const load = await Load.findById(req.params.id);
    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    const oldCarrierId = load.carrier_id;
    const oldLoadNumber = load.load_number;

    // Update carrier
    load.carrier_id = carrier_id;
    load.carrier_source = 'manual';
    load.needs_review = false;
    load.review_reason = null;

    // If save_alias is true and we have carrier_raw_extracted, create alias
    if (save_alias && load.carrier_raw_extracted) {
      try {
        await createCarrierAlias(load.carrier_raw_extracted, carrier_id);
      } catch (aliasError) {
        console.error('Error creating alias:', aliasError);
        // Don't fail the request if alias creation fails
      }
    }

    await load.save();

    // Duplicate conflicts: carrier changed (informational only).
    try {
      if (oldCarrierId && oldLoadNumber) {
        await recalculateDuplicateConflictsForCarrierLoadNumber(oldCarrierId, oldLoadNumber);
      }
      if (load.carrier_id && load.load_number) {
        await recalculateDuplicateConflictsForCarrierLoadNumber(load.carrier_id, load.load_number);
      } else {
        await checkAndUpdateDuplicateConflictsForLoad(load._id, load.carrier_id, load.load_number);
      }
    } catch (e) {
      console.error('Duplicate conflict recalculation failed (patch carrier):', e);
    }

    const populatedLoad = await Load.findById(load._id)
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases')
      .populate('date_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('driver_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('duplicate_conflict_ids', 'load_number pickup_date delivery_date');

    res.json(populatedLoad);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete load
router.delete('/:id', async (req, res) => {
  try {
    const load = await Load.findById(req.params.id);
    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    // Remove from other loads' conflict lists
    await removeFromConflictLists(load._id);

    await Load.findByIdAndDelete(req.params.id);
    res.json({ message: 'Load deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

