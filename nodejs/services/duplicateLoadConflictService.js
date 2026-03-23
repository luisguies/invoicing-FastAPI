const { Load } = require('../db/database');

function normalizeLoadNumber(loadNumber) {
  return (loadNumber || '').toString().trim();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getDuplicateGroupLoads(carrierId, loadNumber) {
  if (!carrierId) return [];
  const normalized = normalizeLoadNumber(loadNumber);
  if (!normalized) return [];

  // Case-insensitive exact match on load_number.
  const rx = new RegExp(`^${escapeRegex(normalized)}$`, 'i');

  return await Load.find({
    cancelled: false,
    carrier_id: carrierId,
    load_number: { $regex: rx }
  }).select('_id load_number carrier_id');
}

async function recalculateDuplicateConflictsForCarrierLoadNumber(carrierId, loadNumber) {
  const loads = await getDuplicateGroupLoads(carrierId, loadNumber);
  if (loads.length === 0) return;

  const ids = loads.map((l) => l._id);

  // For each load, set duplicate_conflict_ids to "all others".
  const updates = loads.map((l) => {
    const otherIds = ids.filter((id) => id.toString() !== l._id.toString());
    return Load.updateOne(
      { _id: l._id },
      {
        $set: {
          duplicate_conflict: otherIds.length > 0,
          duplicate_conflict_ids: otherIds
        }
      }
    );
  });

  await Promise.all(updates);
}

async function clearDuplicateConflictsForLoad(loadId) {
  await Load.updateOne(
    { _id: loadId },
    { $set: { duplicate_conflict: false, duplicate_conflict_ids: [] } }
  );
}

async function checkAndUpdateDuplicateConflictsForLoad(loadId, carrierId, loadNumber) {
  if (!carrierId || !normalizeLoadNumber(loadNumber)) {
    await clearDuplicateConflictsForLoad(loadId);
    return [];
  }

  const groupLoads = await getDuplicateGroupLoads(carrierId, loadNumber);
  const conflictIds = groupLoads
    .filter((l) => l._id.toString() !== loadId.toString())
    .map((l) => l._id);

  await Load.updateOne(
    { _id: loadId },
    {
      $set: {
        duplicate_conflict: conflictIds.length > 0,
        duplicate_conflict_ids: conflictIds
      }
    }
  );

  return conflictIds;
}

module.exports = {
  recalculateDuplicateConflictsForCarrierLoadNumber,
  checkAndUpdateDuplicateConflictsForLoad,
  clearDuplicateConflictsForLoad
};


