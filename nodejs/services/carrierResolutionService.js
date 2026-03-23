const { Carrier, CarrierAlias } = require('../db/database');

/**
 * Normalize carrier string for matching
 * - Uppercase
 * - Remove punctuation
 * - Remove suffixes (LLC, INC, LTD, CORP)
 * - Strip trailing state tags like (TX)
 * - Collapse whitespace
 * @param {string} str - String to normalize
 * @returns {string} Normalized string
 */
function normalizeCarrierString(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  let normalized = str.toUpperCase();
  
  // Remove punctuation
  normalized = normalized.replace(/[.,;:!?'"()]/g, '');
  
  // Remove common suffixes
  normalized = normalized.replace(/\b(LLC|INC|LTD|CORP|CORPORATION|COMPANY|CO)\b/gi, '');
  
  // Remove trailing state tags like (TX) or (TX, USA)
  normalized = normalized.replace(/\s*\([A-Z]{2}(,\s*[A-Z]+)?\)\s*$/i, '');
  
  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

/**
 * Resolve carrier from OCR extracted name using whitelist and aliases
 * Order:
 * 1. Try alias match (normalized)
 * 2. Try direct match against known carriers (normalized)
 * 3. If no match, return null
 * 
 * @param {string} carrierRawExtracted - Raw carrier name from OCR
 * @returns {Promise<Object|null>} Object with carrier_id and source, or null if no match
 */
async function resolveCarrier(carrierRawExtracted) {
  if (!carrierRawExtracted || !carrierRawExtracted.trim()) {
    return null;
  }

  const normalized = normalizeCarrierString(carrierRawExtracted);
  
  if (!normalized) {
    return null;
  }

  // Step 1: Try alias match (normalized)
  const alias = await CarrierAlias.findOne({
    alias_normalized: normalized
  });

  if (alias) {
    return {
      carrier_id: alias.carrier_id,
      source: 'alias'
    };
  }

  // Step 2: Try direct match against known carriers (normalized)
  const carriers = await Carrier.find({});
  
  for (const carrier of carriers) {
    const carrierNormalized = normalizeCarrierString(carrier.name);
    if (carrierNormalized === normalized) {
      return {
        carrier_id: carrier._id,
        source: 'ocr'
      };
    }
  }

  // No match found
  return null;
}

/**
 * Create a new carrier alias
 * @param {string} aliasRaw - Raw alias string
 * @param {ObjectId} carrierId - Carrier ID to associate with
 * @returns {Promise<Object>} Created alias document
 */
async function createCarrierAlias(aliasRaw, carrierId) {
  if (!aliasRaw || !aliasRaw.trim()) {
    throw new Error('Alias raw string is required');
  }

  if (!carrierId) {
    throw new Error('Carrier ID is required');
  }

  const aliasNormalized = normalizeCarrierString(aliasRaw);

  // Check if alias already exists
  const existing = await CarrierAlias.findOne({
    alias_normalized: aliasNormalized,
    carrier_id: carrierId
  });

  if (existing) {
    return existing;
  }

  const alias = new CarrierAlias({
    alias_raw: aliasRaw.trim(),
    alias_normalized: aliasNormalized,
    carrier_id: carrierId
  });

  await alias.save();
  return alias;
}

module.exports = {
  normalizeCarrierString,
  resolveCarrier,
  createCarrierAlias
};

