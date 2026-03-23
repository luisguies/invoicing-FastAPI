const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toUtcMidnight(dateValue) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfWeekMondayUtc(utcMidnight) {
  const dow = utcMidnight.getUTCDay(); // Sun=0 ... Sat=6
  const daysSinceMonday = dow === 0 ? 6 : dow - 1; // Mon=0 ... Sun=6
  return new Date(utcMidnight.getTime() - daysSinceMonday * MS_PER_DAY);
}

/**
 * Weekly selection rule (Monday -> next Monday):
 * - Loads are assigned to the invoice week based on the pickup week (Monday start).
 * - "Ending Monday" is the next Monday boundary (start + 7 days).
 * - If a load delivers AFTER the ending Monday, it is moved to the next invoice week.
 *
 * Notes:
 * - Pickup ON the ending Monday should belong to the next week naturally (it has a different pickup week).
 * - Delivery ON the ending Monday stays in the current week (only AFTER moves).
 *
 * Returns:
 * - invoiceMonday: Date at UTC midnight
 * - invoiceWeekId: "YYYY-MM-DD"
 */
function computeInvoiceWeekFields(pickupDate, deliveryDate) {
  const pickupMidnight = toUtcMidnight(pickupDate);
  const deliveryMidnight = toUtcMidnight(deliveryDate);
  if (!pickupMidnight || !deliveryMidnight) return null;

  let invoiceMonday = startOfWeekMondayUtc(pickupMidnight);

  // If delivery spills past the week boundary, move to next week (repeat if needed).
  // "After the ending Monday" means strictly greater than the boundary date.
  while (deliveryMidnight.getTime() > invoiceMonday.getTime() + 7 * MS_PER_DAY) {
    invoiceMonday = new Date(invoiceMonday.getTime() + 7 * MS_PER_DAY);
  }

  const invoiceWeekId = invoiceMonday.toISOString().slice(0, 10);

  return { invoiceMonday, invoiceWeekId };
}

module.exports = {
  computeInvoiceWeekFields,
  toUtcMidnight
};


