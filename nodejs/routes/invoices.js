const express = require('express');
const router = express.Router();
const multer = require('multer');
const { Invoice, Load, InvoiceRule } = require('../db/database');
const { generateInvoicePDF } = require('../services/pdfService');
const { computeInvoiceWeekFields } = require('../services/invoiceWeekService');
const { resolveCarrier } = require('../services/carrierResolutionService');
const { findOrCreateDriver } = require('../services/carrierDriverService');
const { extractOldInvoice: extractOldInvoiceFromPython } = require('../services/ocrService');
const fs = require('fs');
const path = require('path');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Filename format: "{Carrier Name} Invoice YYYY-MM-DD.pdf" or "... YYYY-MM-DD (PERSON NAME).pdf"
const OLD_INVOICE_FILENAME_REGEX = /^(.+)\s+Invoice\s+(\d{4}-\d{2}-\d{2})(?:\s*\([^)]*\))?\.pdf$/i;

function parseOldInvoiceFilename(filename) {
  const base = path.basename(filename, path.extname(filename)) + '.pdf';
  const match = base.match(OLD_INVOICE_FILENAME_REGEX);
  if (!match) return null;
  const carrierName = match[1].trim();
  return {
    carrierName,
    dateStr: match[2],
    date: new Date(match[2] + 'T00:00:00.000Z')
  };
}

const oldInvoicesDir = process.env.OLD_INVOICES_DIR || path.join(process.cwd(), 'uploads', 'old-invoices');
if (!fs.existsSync(oldInvoicesDir)) {
  fs.mkdirSync(oldInvoicesDir, { recursive: true });
}
const oldInvoiceStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, oldInvoicesDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, unique);
  }
});
const uploadOldInvoice = multer({
  storage: oldInvoiceStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
  limits: { fileSize: 15 * 1024 * 1024 }
});

/**
 * Compute date range for the "default" rule (UTC):
 * - earliest_pickup_date: previous Saturday (the Saturday before the most recent one)
 * - latest_delivery_date: current Monday (the Monday of the week containing today)
 * Example: today Tue 2026-02-03 → previous Saturday 2026-01-24, current Monday 2026-02-02
 */
function getDefaultRuleDatesUtc() {
  const now = new Date();
  const day = now.getUTCDay(); // 0 Sun, 1 Mon, ..., 6 Sat

  // Current Monday (start of week containing today)
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const currentMonday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysSinceMonday,
    0, 0, 0, 0
  ));

  // Previous Saturday = last Saturday - 7 days
  const daysToLastSaturday = (day - 6 + 7) % 7;
  const lastSaturday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysToLastSaturday,
    0, 0, 0, 0
  ));
  const previousSaturday = new Date(lastSaturday.getTime() - 7 * MS_PER_DAY);

  return { earliest_pickup_date: previousSaturday, latest_delivery_date: currentMonday };
}

function parseInvoiceWeekIdToUtcMonday(invoiceWeekId) {
  if (!invoiceWeekId) return null;
  const d = new Date(`${invoiceWeekId}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// Get all invoices (optional query: carrier, dateFrom, dateTo)
router.get('/', async (req, res) => {
  try {
    const { carrier, dateFrom, dateTo } = req.query;
    const conditions = [];

    if (carrier && String(carrier).trim()) {
      const carrierRegex = new RegExp(escapeRegex(String(carrier).trim()), 'i');
      conditions.push({
        $or: [
          { carrier_name: carrierRegex },
          { 'billTo.name': carrierRegex }
        ]
      });
    }

    if (dateFrom || dateTo) {
      const dateCond = {};
      if (dateFrom) {
        const d = new Date(dateFrom);
        if (!Number.isNaN(d.getTime())) dateCond.$gte = d;
      }
      if (dateTo) {
        const d = new Date(dateTo);
        d.setUTCHours(23, 59, 59, 999);
        if (!Number.isNaN(d.getTime())) dateCond.$lte = d;
      }
      if (Object.keys(dateCond).length > 0) {
        conditions.push({
          $or: [
            { invoiceDate: dateCond },
            { invoiceDate: null, generated_at: dateCond }
          ]
        });
      }
    }

    const findQuery = conditions.length > 0 ? { $and: conditions } : {};

    const invoices = await Invoice.find(findQuery)
      .populate('load_ids', 'load_number pickup_date delivery_date carrier_pay carrier_id invoice_monday invoice_week_id')
      .populate('load_ids.carrier_id', 'name aliases')
      .sort({ generated_at: -1 });
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Upload old invoice PDF (filename: "{Carrier Name} Invoice YYYY-MM-DD.pdf")
router.post('/upload-old', uploadOldInvoice.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const filename = req.file.originalname || path.basename(req.file.path);
    const parsed = parseOldInvoiceFilename(filename);
    if (!parsed) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: 'Filename must match: "{Carrier Name} Invoice YYYY-MM-DD.pdf"'
      });
    }
    const invoiceNumber = `OLD-${parsed.dateStr}-${Date.now()}`;
    const invoice = new Invoice({
      invoice_number: invoiceNumber,
      load_ids: [],
      pdf_path: req.file.path,
      invoiceDate: parsed.date,
      carrier_name: parsed.carrierName,
      billTo: { name: parsed.carrierName }
    });
    await invoice.save();
    const populated = await Invoice.findById(invoice._id)
      .populate('load_ids', 'load_number pickup_date delivery_date carrier_pay carrier_id invoice_monday invoice_week_id')
      .populate('load_ids.carrier_id', 'name aliases');
    res.status(201).json({
      success: true,
      invoice: populated,
      parsed: { carrierName: parsed.carrierName, date: parsed.dateStr }
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    }
    res.status(500).json({ error: error.message });
  }
});

// Extract structured data from old invoice PDF (text extraction; driver sections + load lines)
router.post('/extract-old-invoice', uploadOldInvoice.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const data = await extractOldInvoiceFromPython(req.file.path);
    res.json({ success: true, data });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    }
    res.status(500).json({ error: error.message });
  }
});

// Save extracted (and possibly edited) old invoice: create Loads + Invoice
router.post('/save-extracted', uploadOldInvoice.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const dataRaw = req.body.data;
    if (!dataRaw) {
      return res.status(400).json({ error: 'Missing body field: data (JSON string of extracted invoice)' });
    }
    let data;
    try {
      data = typeof dataRaw === 'string' ? JSON.parse(dataRaw) : dataRaw;
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON in data field' });
    }
    const carrierName = (data.carrierName || data.billTo?.name || '').trim();
    if (!carrierName) {
      return res.status(400).json({ error: 'Carrier name is required' });
    }
    const resolution = await resolveCarrier(carrierName);
    const carrier_id = resolution ? resolution.carrier_id : null;
    if (!carrier_id) {
      return res.status(400).json({
        error: `Carrier "${carrierName}" not found. Add the carrier in Settings first or use an existing alias.`
      });
    }
    const groups = Array.isArray(data.groups) ? data.groups : [];
    const loadIds = [];
    for (const group of groups) {
      const driverName = (group.groupLabel || '').trim();
      const driver = driverName ? await findOrCreateDriver(driverName, carrier_id) : null;
      const driver_id = driver ? driver._id : null;
      const lines = Array.isArray(group.lines) ? group.lines : [];
      for (const line of lines) {
        const pickupStr = line.pickupDate || '';
        const deliveryStr = line.deliveryDate || '';
        const price = parseFloat(String(line.price || '0').replace(/,/g, '')) || 0;
        const pickupDate = pickupStr ? new Date(pickupStr) : null;
        const deliveryDate = deliveryStr ? new Date(deliveryStr) : null;
        if (!pickupDate || Number.isNaN(pickupDate.getTime()) || !deliveryDate || Number.isNaN(deliveryDate.getTime())) {
          continue;
        }
        const invoiceWeek = computeInvoiceWeekFields(pickupDate, deliveryDate);
        const invoiceMonday = invoiceWeek ? invoiceWeek.invoiceMonday : null;
        const invoiceWeekId = invoiceWeek ? invoiceWeek.invoiceWeekId : null;
        const loadNumber = `LOAD-${pickupStr.replace(/\//g, '-')}-${price}`;
        const originParts = (line.originCityState || '').split(',').map(s => s.trim());
        const destParts = (line.destCityState || '').split(',').map(s => s.trim());
        const pickup_city = originParts[0] || '';
        const pickup_state = originParts[1] || '';
        const delivery_city = destParts[0] || '';
        const delivery_state = destParts[1] || '';
        const load = new Load({
          carrier_id,
          carrier_raw_extracted: carrierName,
          carrier_source: 'manual',
          driver_id,
          load_number: loadNumber,
          carrier_pay: price,
          pickup_date: pickupDate,
          delivery_date: deliveryDate,
          invoice_monday: invoiceMonday,
          invoice_week_id: invoiceWeekId,
          pickup_city,
          pickup_state,
          delivery_city,
          delivery_state,
          pdf_filename: req.file.originalname || path.basename(req.file.path),
          cancelled: false,
          confirmed: true,
          invoiced: true
        });
        await load.save();
        loadIds.push(load._id);
      }
    }
    const invoiceNumber = (data.invoiceNumber || '').trim() || `INV-OLD-${Date.now()}`;
    const invoiceDate = data.invoiceDate ? new Date(data.invoiceDate) : new Date();
    const dueDate = data.dueDate ? new Date(data.dueDate) : null;
    const subtotal = parseFloat(String(data.subtotal || data.total || '0').replace(/,/g, '')) || 0;
    const postage = parseFloat(String(data.postage || '0').replace(/,/g, '')) || 0;
    const total = parseFloat(String(data.total || data.balanceDue || '0').replace(/,/g, '')) || subtotal;
    const balanceDue = parseFloat(String(data.balanceDue || data.total || '0').replace(/,/g, '')) || total;
    const billTo = data.billTo && typeof data.billTo === 'object'
      ? { name: data.billTo.name || carrierName, cityStateZip: data.billTo.cityStateZip || '', phone: data.billTo.phone || '' }
      : { name: carrierName, cityStateZip: '', phone: '' };
    const payableTo = data.payableTo && typeof data.payableTo === 'object'
      ? { name: data.payableTo.name || '', cityStateZip: data.payableTo.cityStateZip || '', phone: data.payableTo.phone || '' }
      : { name: '', cityStateZip: '', phone: '' };
    const groupsForInvoice = groups.map(g => ({
      groupLabel: g.groupLabel || '',
      groupRate: g.groupRate || '',
      lines: (g.lines || []).map(l => ({
        pickupDate: l.pickupDate || '',
        deliveryDate: l.deliveryDate || '',
        originCityState: l.originCityState || '',
        destCityState: l.destCityState || '',
        price: l.price || '',
        ratePercent: l.ratePercent || '',
        amount: l.amount || ''
      }))
    }));
    const invoice = new Invoice({
      invoice_number: invoiceNumber,
      load_ids: loadIds,
      pdf_path: req.file.path,
      invoiceDate,
      dueDate,
      billTo,
      payableTo,
      subtotal,
      postage,
      total,
      balanceDue,
      groups: groupsForInvoice,
      carrier_name: carrierName
    });
    await invoice.save();
    const populated = await Invoice.findById(invoice._id)
      .populate('load_ids', 'load_number pickup_date delivery_date carrier_pay carrier_id invoice_monday invoice_week_id')
      .populate('load_ids.carrier_id', 'name aliases');
    res.status(201).json({
      success: true,
      invoice: populated,
      message: 'Invoice and loads created successfully'
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    }
    res.status(500).json({ error: error.message });
  }
});

// Get invoice by ID
router.get('/:id', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('load_ids', 'load_number pickup_date delivery_date carrier_pay carrier_id driver_id')
      .populate('load_ids.carrier_id', 'name aliases')
      .populate('load_ids.driver_id', 'name aliases');
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Download invoice PDF
router.get('/:id/pdf', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (!fs.existsSync(invoice.pdf_path)) {
      return res.status(404).json({ error: 'PDF file not found' });
    }

    // Check if this is a view request (no download header) or download request
    const disposition = req.query.download === 'true' 
      ? `attachment; filename="${path.basename(invoice.pdf_path)}"`
      : `inline; filename="${path.basename(invoice.pdf_path)}"`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', disposition);
    
    const fileStream = fs.createReadStream(invoice.pdf_path);
    fileStream.pipe(res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark invoice as paid/unpaid
router.patch('/:id/paid', async (req, res) => {
  try {
    const { paid, paid_date } = req.body;

    if (paid === undefined) {
      return res.status(400).json({ error: 'paid field is required' });
    }

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    invoice.paid = paid === true;
    if (invoice.paid) {
      if (!paid_date) {
        return res.status(400).json({ error: 'paid_date is required when marking invoice as paid' });
      }
      const parsedPaidDate = new Date(`${paid_date}T00:00:00.000Z`);
      if (Number.isNaN(parsedPaidDate.getTime())) {
        return res.status(400).json({ error: 'paid_date must be a valid date (YYYY-MM-DD)' });
      }
      invoice.paid_date = parsedPaidDate;
    } else {
      invoice.paid_date = null;
    }
    await invoice.save();

    const populated = await Invoice.findById(invoice._id)
      .populate('load_ids', 'load_number pickup_date delivery_date carrier_pay carrier_id invoice_monday invoice_week_id')
      .populate('load_ids.carrier_id', 'name aliases');

    res.json(populated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete invoice (and remove stored PDF if present)
router.delete('/:id', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const pdfPath = invoice.pdf_path;
    if (pdfPath && fs.existsSync(pdfPath)) {
      try {
        fs.unlinkSync(pdfPath);
      } catch (e) {
        // Don't fail the delete if file removal fails; report it.
        console.error('Failed to delete invoice PDF:', e);
      }
    }

    // Unmark loads as invoiced when invoice is deleted
    if (invoice.load_ids && Array.isArray(invoice.load_ids) && invoice.load_ids.length > 0) {
      await Load.updateMany(
        { _id: { $in: invoice.load_ids } },
        { $set: { invoiced: false } }
      );
    }

    await Invoice.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Invoice deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate invoice
router.post('/generate', async (req, res) => {
  try {
    const { load_ids, rule_id, invoiceData, includeUnconfirmed } = req.body;

    let loadIdsToUse = [];

    // If rule_id is provided, use rule to filter loads
    if (rule_id) {
      const rule = await InvoiceRule.findById(rule_id);
      if (!rule) {
        return res.status(404).json({ error: 'Rule not found' });
      }

      const query = {
        cancelled: false, // Always exclude cancelled loads
        invoiced: false // Always exclude invoiced loads
      };

      if (rule.carrier_id) {
        query.carrier_id = rule.carrier_id;
      }

      // For "default" rule, use computed dates: previous Saturday → current Monday
      const isDefaultRule = rule.rule_name && rule.rule_name.toLowerCase() === 'default';
      const defaultDates = isDefaultRule ? getDefaultRuleDatesUtc() : null;
      const earliest_pickup_date = defaultDates ? defaultDates.earliest_pickup_date : rule.earliest_pickup_date;
      const latest_delivery_date = defaultDates ? defaultDates.latest_delivery_date : rule.latest_delivery_date;

      // Weekly selection semantics:
      // - earliest_pickup_date is inclusive (start boundary)
      // - latest_delivery_date represents the "ending Monday" boundary
      //   - pickup ON the ending Monday should move to the next invoice => pickup_date is EXCLUSIVE (<)
      //   - delivery AFTER the ending Monday should move to the next invoice => delivery_date is INCLUSIVE (<=)
      if (earliest_pickup_date) {
        query.pickup_date = { $gte: earliest_pickup_date };
      }

      if (latest_delivery_date) {
        if (query.pickup_date) {
          query.pickup_date.$lt = latest_delivery_date;
        } else {
          query.pickup_date = { $lt: latest_delivery_date };
        }
        query.delivery_date = { $lte: latest_delivery_date };
      }

      // Only include confirmed loads unless user explicitly allows unconfirmed
      if (!includeUnconfirmed) {
        query.confirmed = true;
      }

      const loads = await Load.find(query).select('_id');
      loadIdsToUse = loads.map(load => load._id);
    } else if (load_ids && Array.isArray(load_ids)) {
      // Use provided load IDs, but filter out cancelled (and optionally unconfirmed)
      const query = {
        _id: { $in: load_ids },
        cancelled: false,
        invoiced: false // Always exclude invoiced loads
      };

      // Only include confirmed loads unless user explicitly allows unconfirmed
      if (!includeUnconfirmed) {
        query.confirmed = true;
      }

      const loads = await Load.find(query).select('_id');
      loadIdsToUse = loads.map(load => load._id);
    } else {
      return res.status(400).json({ error: 'Either load_ids or rule_id must be provided' });
    }

    if (loadIdsToUse.length === 0) {
      return res.status(400).json({ error: 'No valid loads found for invoice generation' });
    }

    // Split by carrier + invoice week so clicking "Generate Invoices" is automatic and safe.
    // The PDF generation assumes a single carrier for bill-to details.
    const loadsForGrouping = await Load.find({
      _id: { $in: loadIdsToUse },
      cancelled: false,
      invoiced: false // Double-check: exclude invoiced loads
    }).select('_id carrier_id pickup_date delivery_date invoice_monday invoice_week_id');

    const missingCarrier = loadsForGrouping.filter(l => !l.carrier_id).map(l => l._id);
    if (missingCarrier.length > 0) {
      return res.status(400).json({
        error: 'Some loads are missing carrier assignment. Assign a carrier before generating invoices.',
        missing_carrier_load_ids: missingCarrier
      });
    }

    // Auto-compute/backfill invoice fields for these loads (no Mongo date math).
    const invoiceFieldUpdates = [];
    const computedByLoadId = new Map(); // loadIdStr -> { invoiceMonday, invoiceWeekId }

    for (const l of loadsForGrouping) {
      if (!l.pickup_date || !l.delivery_date) {
        return res.status(400).json({
          error: 'Some loads are missing pickup_date or delivery_date; cannot generate invoices.'
        });
      }

      const computed = computeInvoiceWeekFields(l.pickup_date, l.delivery_date);
      if (!computed) {
        return res.status(400).json({
          error: 'Some loads have invalid pickup_date or delivery_date; cannot generate invoices.'
        });
      }

      computedByLoadId.set(l._id.toString(), computed);

      const existingMondayMs = l.invoice_monday ? new Date(l.invoice_monday).getTime() : null;
      const computedMondayMs = computed.invoiceMonday.getTime();
      const existingWeekId = l.invoice_week_id || null;

      const needsUpdate =
        existingMondayMs !== computedMondayMs ||
        existingWeekId !== computed.invoiceWeekId;

      if (needsUpdate) {
        invoiceFieldUpdates.push({
          updateOne: {
            filter: { _id: l._id },
            update: {
              $set: {
                invoice_monday: computed.invoiceMonday,
                invoice_week_id: computed.invoiceWeekId
              }
            }
          }
        });
      }
    }

    if (invoiceFieldUpdates.length > 0) {
      await Load.bulkWrite(invoiceFieldUpdates, { ordered: false });
    }

    const byCarrierAndWeek = new Map(); // `${carrierIdStr}|${invoiceWeekId}` -> loadId[]
    for (const l of loadsForGrouping) {
      const carrierIdStr = l.carrier_id.toString();
      const computed = computedByLoadId.get(l._id.toString());
      const invoiceWeekId = computed ? computed.invoiceWeekId : (l.invoice_week_id || null);
      if (!invoiceWeekId) {
        return res.status(400).json({
          error: 'Unable to determine invoice week for one or more loads.'
        });
      }

      const key = `${carrierIdStr}|${invoiceWeekId}`;
      if (!byCarrierAndWeek.has(key)) byCarrierAndWeek.set(key, []);
      byCarrierAndWeek.get(key).push(l._id);
    }

    const baseInvoiceNumber = invoiceData?.invoiceNumber || `INV-${Date.now()}`;
    const groupKeys = Array.from(byCarrierAndWeek.keys()).sort();

    const createdInvoices = [];
    for (let i = 0; i < groupKeys.length; i += 1) {
      const key = groupKeys[i];
      const loadIds = byCarrierAndWeek.get(key) || [];
      if (loadIds.length === 0) continue;

      const parts = key.split('|');
      const invoiceWeekId = parts[1] || '';
      const weekCompact = invoiceWeekId ? invoiceWeekId.replace(/-/g, '') : 'unknownweek';

      // Ensure uniqueness if we end up creating multiple invoices in one request.
      const invoiceNumber =
        groupKeys.length === 1
          ? baseInvoiceNumber
          : `${baseInvoiceNumber}-${weekCompact}-${String(i + 1).padStart(2, '0')}`;

      const invoiceWeekMonday = parseInvoiceWeekIdToUtcMonday(invoiceWeekId);
      const endingMonday =
        invoiceWeekMonday ? new Date(invoiceWeekMonday.getTime() + 7 * MS_PER_DAY) : null;
      const endingMondayId = endingMonday ? endingMonday.toISOString().slice(0, 10) : null;

      const result = await generateInvoicePDF(loadIds, {
        ...(invoiceData || {}),
        invoiceNumber,
        endingMonday: endingMondayId
      });

      const pdfPath = result.pdfPath;
      const fullInvoiceData = result.invoiceData;

      const invoice = new Invoice({
        invoice_number: invoiceNumber,
        load_ids: loadIds,
        pdf_path: pdfPath,
        invoiceDate: fullInvoiceData.invoiceDate,
        dueDate: fullInvoiceData.dueDate,
        billTo: fullInvoiceData.billTo,
        payableTo: fullInvoiceData.payableTo,
        subtotal: fullInvoiceData.subtotal,
        postage: fullInvoiceData.postage,
        total: fullInvoiceData.total,
        balanceDue: fullInvoiceData.balanceDue,
        cta: fullInvoiceData.cta,
        paymentLine: fullInvoiceData.paymentLine,
        groups: fullInvoiceData.groups
      });

      await invoice.save();
      createdInvoices.push(invoice);
    }

    // Mark all loads in the created invoices as invoiced
    const allInvoicedLoadIds = [];
    for (const invoice of createdInvoices) {
      if (invoice.load_ids && Array.isArray(invoice.load_ids)) {
        allInvoicedLoadIds.push(...invoice.load_ids);
      }
    }

    if (allInvoicedLoadIds.length > 0) {
      await Load.updateMany(
        { _id: { $in: allInvoicedLoadIds } },
        { $set: { invoiced: true } }
      );
    }

    const populatedInvoices = await Invoice.find({ _id: { $in: createdInvoices.map(i => i._id) } })
      .populate('load_ids', 'load_number pickup_date delivery_date carrier_pay')
      .sort({ generated_at: -1 });

    res.status(201).json({
      success: true,
      invoices: populatedInvoices,
      count: populatedInvoices.length,
      message: populatedInvoices.length === 1 ? 'Invoice generated successfully' : 'Invoices generated successfully'
    });

  } catch (error) {
    console.error('Invoice generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

