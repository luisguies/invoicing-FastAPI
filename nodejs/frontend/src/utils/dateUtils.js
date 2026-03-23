/**
 * Format date to MM/DD/YYYY
 * @param {Date|string} date - Date object or date string
 * @returns {string} Formatted date string
 */
export const formatDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  // Use UTC components to keep "date-only" values stable across time zones.
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${month}/${day}/${year}`;
};

/**
 * Format date to YYYY-MM-DD for input fields
 * @param {Date|string} date - Date object or date string
 * @returns {string} Formatted date string
 */
export const formatDateInput = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  // Use UTC components to keep "date-only" values stable across time zones.
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${year}-${month}-${day}`;
};

/**
 * Parse a YYYY-MM-DD input string into a Date at UTC midnight.
 * This avoids "off by one day" issues when running in non-UTC time zones.
 * @param {string} value
 * @returns {Date|null}
 */
export const parseDateInputToUtcDate = (value) => {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(Date.UTC(y, mo, d));
};

