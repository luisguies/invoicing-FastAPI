const { Carrier, Driver } = require('../db/database');

/**
 * Find or create a carrier by name or alias
 * @param {string} carrierName - Carrier name to match
 * @returns {Promise<Object>} Carrier document
 */
async function findOrCreateCarrier(carrierName) {
  if (!carrierName || !carrierName.trim()) {
    throw new Error('Carrier name is required');
  }

  const name = carrierName.trim();
  
  // Try to find by exact name (case-insensitive)
  let carrier = await Carrier.findOne({
    $or: [
      { name: { $regex: new RegExp(`^${name}$`, 'i') } },
      { aliases: { $regex: new RegExp(`^${name}$`, 'i') } }
    ]
  });

  if (!carrier) {
    // Create new carrier
    carrier = new Carrier({
      name: name,
      aliases: []
    });
    await carrier.save();
  }

  return carrier;
}

/**
 * Find or create a driver by name or alias
 * @param {string} driverName - Driver name to match
 * @param {ObjectId} carrierId - Carrier ID that the driver belongs to
 * @returns {Promise<Object>} Driver document
 */
async function findOrCreateDriver(driverName, carrierId) {
  if (!driverName || !driverName.trim()) {
    return null; // Driver is optional
  }

  if (!carrierId) {
    throw new Error('Carrier ID is required to create a driver');
  }

  const name = driverName.trim();
  
  // Try to find by exact name (case-insensitive) within the same carrier
  let driver = await Driver.findOne({
    carrier_id: carrierId,
    $or: [
      { name: { $regex: new RegExp(`^${name}$`, 'i') } },
      { aliases: { $regex: new RegExp(`^${name}$`, 'i') } }
    ]
  });

  if (!driver) {
    // Create new driver
    driver = new Driver({
      name: name,
      aliases: [],
      carrier_id: carrierId
    });
    await driver.save();

    // Update carrier's driver_ids array
    await Carrier.findByIdAndUpdate(carrierId, {
      $addToSet: { driver_ids: driver._id }
    });
  }

  return driver;
}

/**
 * Add an alias to a carrier
 * @param {ObjectId} carrierId - Carrier ID
 * @param {string} alias - Alias to add
 */
async function addCarrierAlias(carrierId, alias) {
  if (!alias || !alias.trim()) {
    return;
  }

  const aliasTrimmed = alias.trim();
  await Carrier.findByIdAndUpdate(carrierId, {
    $addToSet: { aliases: aliasTrimmed }
  });
}

/**
 * Add an alias to a driver
 * @param {ObjectId} driverId - Driver ID
 * @param {string} alias - Alias to add
 */
async function addDriverAlias(driverId, alias) {
  if (!alias || !alias.trim()) {
    return;
  }

  const aliasTrimmed = alias.trim();
  await Driver.findByIdAndUpdate(driverId, {
    $addToSet: { aliases: aliasTrimmed }
  });
}

/**
 * Process extracted OCR data and create/find carrier and driver
 * @param {Object} ocrData - Extracted data from OCR
 * @returns {Promise<Object>} Object with carrier_id and driver_id
 */
async function processCarrierAndDriver(ocrData) {
  const carrierName = ocrData.carrier_name;
  if (!carrierName) {
    throw new Error('Carrier name is required in OCR data');
  }

  // Find or create carrier
  const carrier = await findOrCreateCarrier(carrierName);
  
  // If carrier name in OCR doesn't match the stored name, add it as an alias
  if (carrierName.trim().toLowerCase() !== carrier.name.toLowerCase()) {
    await addCarrierAlias(carrier._id, carrierName);
  }

  // Find or create driver (if provided)
  let driver = null;
  if (ocrData.driver_name) {
    driver = await findOrCreateDriver(ocrData.driver_name, carrier._id);
    
    // If driver name in OCR doesn't match the stored name, add it as an alias
    if (driver && ocrData.driver_name.trim().toLowerCase() !== driver.name.toLowerCase()) {
      await addDriverAlias(driver._id, ocrData.driver_name);
    }
  }

  return {
    carrier_id: carrier._id,
    driver_id: driver ? driver._id : null
  };
}

module.exports = {
  findOrCreateCarrier,
  findOrCreateDriver,
  addCarrierAlias,
  addDriverAlias,
  processCarrierAndDriver
};

