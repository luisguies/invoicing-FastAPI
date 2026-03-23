const { Load } = require('../db/database');

/**
 * Normalize a Date to a date-only UTC midnight Date.
 * This keeps comparisons strictly "date-only" (no times).
 * @param {Date} d
 * @returns {Date}
 */
function toUtcDateOnly(d) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  return new Date(Date.UTC(y, m, day));
}

/**
 * Strict half-open interval overlap check:
 * [pickupA, deliveryA) overlaps [pickupB, deliveryB) iff:
 * pickupA < deliveryB AND pickupB < deliveryA
 *
 * Boundary-touching is allowed:
 * deliveryA === pickupB => NOT a conflict
 */
function intervalsOverlapDateOnly(pickupA, deliveryA, pickupB, deliveryB) {
  const aStart = toUtcDateOnly(pickupA);
  const aEnd = toUtcDateOnly(deliveryA);
  const bStart = toUtcDateOnly(pickupB);
  const bEnd = toUtcDateOnly(deliveryB);

  return aStart < bEnd && bStart < aEnd;
}

async function findDriverConflictingLoads(loadId, pickupDate, deliveryDate, driverId) {
  if (!driverId) return [];
  if (!pickupDate || !deliveryDate) return [];

  const query = {
    _id: { $ne: loadId },
    cancelled: false,
    driver_id: driverId
  };

  const loads = await Load.find(query).select('_id pickup_date delivery_date');
  const conflictIds = [];

  for (const load of loads) {
    if (!load.pickup_date || !load.delivery_date) continue;
    if (intervalsOverlapDateOnly(pickupDate, deliveryDate, load.pickup_date, load.delivery_date)) {
      conflictIds.push(load._id);
    }
  }

  return conflictIds;
}

async function updateLoadDriverConflicts(loadId, conflictIds) {
  const load = await Load.findById(loadId);
  if (!load) return null;

  load.driver_conflict_ids = conflictIds;
  load.driver_conflict = conflictIds.length > 0;
  await load.save();
  return load;
}

/**
 * Recalculate conflicts for *all* non-cancelled loads for a driver.
 * This keeps conflict lists symmetric and consistent.
 */
async function recalculateDriverConflictsForDriver(driverId) {
  if (!driverId) return;

  const loads = await Load.find({ cancelled: false, driver_id: driverId })
    .select('_id pickup_date delivery_date');

  // Compute conflicts O(n^2); driver load counts are expected to be small.
  const byId = new Map();
  for (const l of loads) {
    byId.set(l._id.toString(), l);
  }

  const conflictMap = new Map(); // id -> array<ObjectId>
  for (const l of loads) {
    conflictMap.set(l._id.toString(), []);
  }

  for (let i = 0; i < loads.length; i++) {
    const a = loads[i];
    if (!a.pickup_date || !a.delivery_date) continue;
    for (let j = i + 1; j < loads.length; j++) {
      const b = loads[j];
      if (!b.pickup_date || !b.delivery_date) continue;

      if (intervalsOverlapDateOnly(a.pickup_date, a.delivery_date, b.pickup_date, b.delivery_date)) {
        conflictMap.get(a._id.toString()).push(b._id);
        conflictMap.get(b._id.toString()).push(a._id);
      }
    }
  }

  // Persist results
  const updates = [];
  for (const [id, conflictIds] of conflictMap.entries()) {
    updates.push(
      Load.updateOne(
        { _id: id },
        {
          $set: {
            driver_conflict_ids: conflictIds,
            driver_conflict: conflictIds.length > 0
          }
        }
      )
    );
  }
  await Promise.all(updates);
}

/**
 * Main helper for "driver assignment changed" or "dates changed".
 * Always informational: do not throw from callers; they should swallow errors.
 */
async function checkAndUpdateDriverConflictsForLoad(loadId, pickupDate, deliveryDate, driverId) {
  if (!driverId || !pickupDate || !deliveryDate) {
    await Load.updateOne(
      { _id: loadId },
      { $set: { driver_conflict: false, driver_conflict_ids: [] } }
    );
    return [];
  }

  const conflictIds = await findDriverConflictingLoads(loadId, pickupDate, deliveryDate, driverId);
  await updateLoadDriverConflicts(loadId, conflictIds);
  return conflictIds;
}

module.exports = {
  intervalsOverlapDateOnly,
  findDriverConflictingLoads,
  updateLoadDriverConflicts,
  recalculateDriverConflictsForDriver,
  checkAndUpdateDriverConflictsForLoad
};


