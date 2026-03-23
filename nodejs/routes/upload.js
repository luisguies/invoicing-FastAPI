const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { processPDFBuffer } = require('../services/ocrService');
const { findOrCreateDriver } = require('../services/carrierDriverService');
const { resolveCarrier } = require('../services/carrierResolutionService');
const { checkAndUpdateConflicts } = require('../services/loadConflictService');
const { recalculateDriverConflictsForDriver, checkAndUpdateDriverConflictsForLoad } = require('../services/driverConflictService');
const { recalculateDuplicateConflictsForCarrierLoadNumber, checkAndUpdateDuplicateConflictsForLoad } = require('../services/duplicateLoadConflictService');
const { Load } = require('../db/database');
const { computeInvoiceWeekFields } = require('../services/invoiceWeekService');

function toUploadsRelativePath(filePath) {
  const filename = path.basename(filePath || '');
  return filename ? `uploads/${filename}` : null;
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = '/app/uploads';
    // Ensure directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Upload and process single PDF
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const filename = req.file.originalname;

    // Read file buffer
    const fileBuffer = fs.readFileSync(filePath);

    // Process PDF with OCR
    const ocrData = await processPDFBuffer(fileBuffer, filename);

    if (!ocrData) {
      return res.status(400).json({ error: 'Could not extract data from PDF' });
    }

    // Resolve carrier using whitelist and aliases
    const carrierRawExtracted = ocrData.carrier_name;
    const carrierResolution = carrierRawExtracted ? await resolveCarrier(carrierRawExtracted) : null;

    let carrier_id = null;
    let carrier_source = 'ocr';
    let needs_review = false;
    let review_reason = null;

    if (carrierResolution) {
      carrier_id = carrierResolution.carrier_id;
      carrier_source = carrierResolution.source;
    } else if (carrierRawExtracted) {
      // No match found - requires manual review
      needs_review = true;
      review_reason = 'carrier_unconfirmed';
    }

    // Process driver (only if we have a carrier_id)
    let driver_id = null;
    if (carrier_id && ocrData.driver_name) {
      try {
        const driver = await findOrCreateDriver(ocrData.driver_name, carrier_id);
        if (driver) {
          driver_id = driver._id;
        }
      } catch (error) {
        console.error('Error processing driver:', error);
        // Continue without driver if processing fails
      }
    }

    // Parse dates
    const pickupDate = ocrData.pickup_date ? new Date(ocrData.pickup_date) : null;
    const deliveryDate = ocrData.delivery_date ? new Date(ocrData.delivery_date) : null;

    if (!pickupDate || !deliveryDate) {
      return res.status(400).json({ error: 'Pickup and delivery dates are required' });
    }

    const invoiceFields = computeInvoiceWeekFields(pickupDate, deliveryDate);
    if (!invoiceFields) {
      return res.status(400).json({ error: 'Invalid pickup_date or delivery_date' });
    }

    // Create load
    const load = new Load({
      carrier_id: carrier_id,
      carrier_raw_extracted: carrierRawExtracted || null,
      carrier_source: carrier_source,
      needs_review: needs_review,
      review_reason: review_reason,
      driver_id: driver_id,
      load_number: ocrData.load_number || `LOAD-${Date.now()}`,
      carrier_pay: parseFloat(ocrData.carrier_pay) || 0,
      pickup_date: pickupDate,
      delivery_date: deliveryDate,
      invoice_monday: invoiceFields.invoiceMonday,
      invoice_week_id: invoiceFields.invoiceWeekId,
      pickup_city: ocrData.pickup_city || '',
      pickup_state: ocrData.pickup_state || '',
      delivery_city: ocrData.delivery_city || '',
      delivery_state: ocrData.delivery_state || '',
      pdf_filename: filename,
      rate_confirmation_path: toUploadsRelativePath(filePath),
      cancelled: false,
      confirmed: false
    });

    await load.save();

    // Check for date conflicts
    await checkAndUpdateConflicts(
      load._id,
      load.pickup_date,
      load.delivery_date,
      load.driver_id
    );

    // Driver conflicts (informational only)
    try {
      if (load.driver_id) {
        await recalculateDriverConflictsForDriver(load.driver_id);
      } else {
        await checkAndUpdateDriverConflictsForLoad(load._id, load.pickup_date, load.delivery_date, null);
      }
    } catch (e) {
      console.error('Driver conflict recalculation failed (upload):', e);
    }

    // Duplicate load number conflicts (informational only)
    try {
      if (load.carrier_id && load.load_number) {
        await recalculateDuplicateConflictsForCarrierLoadNumber(load.carrier_id, load.load_number);
      } else {
        await checkAndUpdateDuplicateConflictsForLoad(load._id, load.carrier_id, load.load_number);
      }
    } catch (e) {
      console.error('Duplicate conflict recalculation failed (upload):', e);
    }

    // Populate and return
    const populatedLoad = await Load.findById(load._id)
      .populate('carrier_id', 'name aliases')
      .populate('driver_id', 'name aliases')
      .populate('date_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('driver_conflict_ids', 'load_number pickup_date delivery_date')
      .populate('duplicate_conflict_ids', 'load_number pickup_date delivery_date');

    res.status(201).json({
      success: true,
      load: populatedLoad,
      message: 'PDF processed and load created successfully'
    });

  } catch (error) {
    console.error('Upload error:', error);
    
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

