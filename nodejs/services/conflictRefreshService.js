const { Load } = require('../db/database');
const { recalculateDriverConflictsForDriver } = require('./driverConflictService');
const { recalculateDuplicateConflictsForCarrierLoadNumber } = require('./duplicateLoadConflictService');

function normalizeLoadNumberKey(loadNumber) {
  return (loadNumber || '').toString().trim().toLowerCase();
}

async function runBatched(items, batchSize, fn) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(fn));
  }
}

/**
 * Refreshes informational conflict flags for a set of loads:
 * - driver_conflict + driver_conflict_ids
 * - duplicate_conflict + duplicate_conflict_ids (carrier_id + load_number)
 *
 * This is used on "list refresh" endpoints so the UI reflects the latest conflict state.
 * Never throws to callers (conflicts must not block rendering).
 *
 * @param {Array<{_id:any, driver_id:any, carrier_id:any, load_number:string}>} loads
 */
async function refreshConflictsForLoads(loads) {
  try {
    const driverIds = new Set();
    const duplicatePairs = new Map(); // key -> { carrierId, loadNumber }

    const clearDriverIds = [];
    const clearDuplicateIds = [];

    for (const l of loads || []) {
      if (l?.driver_id) {
        driverIds.add(l.driver_id.toString());
      } else if (l?._id) {
        clearDriverIds.push(l._id);
      }

      const carrierId = l?.carrier_id ? l.carrier_id.toString() : null;
      const lnKey = normalizeLoadNumberKey(l?.load_number);
      if (carrierId && lnKey) {
        const key = `${carrierId}|${lnKey}`;
        if (!duplicatePairs.has(key)) {
          duplicatePairs.set(key, { carrierId, loadNumber: (l.load_number || '').toString().trim() });
        }
      } else if (l?._id) {
        clearDuplicateIds.push(l._id);
      }
    }

    // Clear flags for loads that can't be in conflict due to missing fields.
    if (clearDriverIds.length > 0) {
      await Load.updateMany(
        { _id: { $in: clearDriverIds } },
        { $set: { driver_conflict: false, driver_conflict_ids: [] } }
      );
    }
    if (clearDuplicateIds.length > 0) {
      await Load.updateMany(
        { _id: { $in: clearDuplicateIds } },
        { $set: { duplicate_conflict: false, duplicate_conflict_ids: [] } }
      );
    }

    // Recalculate driver conflicts per driver (batched).
    await runBatched(Array.from(driverIds), 10, async (driverId) => {
      try {
        await recalculateDriverConflictsForDriver(driverId);
      } catch (e) {
        console.error('Driver conflict recalculation failed (refresh):', driverId, e);
      }
    });

    // Recalculate duplicate conflicts per (carrier, load_number) pair (batched).
    await runBatched(Array.from(duplicatePairs.values()), 10, async (pair) => {
      try {
        await recalculateDuplicateConflictsForCarrierLoadNumber(pair.carrierId, pair.loadNumber);
      } catch (e) {
        console.error('Duplicate conflict recalculation failed (refresh):', pair, e);
      }
    });
  } catch (e) {
    console.error('Conflict refresh failed:', e);
  }
}

module.exports = {
  refreshConflictsForLoads
};


