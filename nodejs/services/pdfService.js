const { chromium } = require('playwright');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const { Load, Dispatcher, Settings } = require('../db/database');

function sanitizeFilenameComponent(value) {
  // Make a filesystem-safe filename component (works well for Windows + Linux).
  return (value || '')
    .toString()
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-') // illegal on Windows (and generally troublesome)
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '') // avoid trailing dots (Windows)
    .slice(0, 180); // keep it reasonable
}

function uniquePdfPath(dir, baseName) {
  const base = sanitizeFilenameComponent(baseName) || 'invoice';
  let candidate = path.join(dir, `${base}.pdf`);
  if (!fs.existsSync(candidate)) return candidate;

  // If a file already exists, add a suffix.
  for (let i = 2; i < 500; i += 1) {
    candidate = path.join(dir, `${base} (${i}).pdf`);
    if (!fs.existsSync(candidate)) return candidate;
  }

  // Fallback (very unlikely).
  return path.join(dir, `${base}-${Date.now()}.pdf`);
}

/**
 * Generate PDF invoice from loads data
 * @param {Array} loadIds - Array of load IDs to include in invoice
 * @param {Object} invoiceData - Invoice metadata (invoiceNumber, dates, billTo, payableTo, etc.)
 * @returns {Promise<string>} Path to generated PDF file
 */
async function generateInvoicePDF(loadIds, invoiceData) {
  // Filter out cancelled loads
  const loads = await Load.find({
    _id: { $in: loadIds },
    cancelled: false
  })
    .populate('carrier_id', 'name aliases billTo')
    .populate('driver_id', 'name aliases groupLabel')
    .sort({ driver_id: 1, pickup_date: 1 });

  if (loads.length === 0) {
    throw new Error('No valid loads to include in invoice');
  }

  // Get active dispatcher for payableTo
  const activeDispatcher = await Dispatcher.findOne({ isActive: true });
  if (!activeDispatcher) {
    throw new Error('No active dispatcher found. Please set an active dispatcher.');
  }

  // Get settings for default rate
  let settings = await Settings.findOne();
  if (!settings) {
    settings = new Settings({ defaultRate: 5.0 });
    await settings.save();
  }
  const defaultRate = settings.defaultRate || 5.0;

  // Get billTo from first load's carrier (assuming all loads have same carrier for billTo)
  // In practice, you might want to handle multiple carriers differently
  const firstLoad = loads[0];
  const carrier = firstLoad.carrier_id;
  const billTo = carrier.billTo || {};

  // Group loads by driver (driver is the groupLabel in tables)
  const grouped = {};
  let subtotal = 0;

  for (const load of loads) {
    // Use driver_id for grouping, handle loads without driver
    const driverId = load.driver_id 
      ? load.driver_id._id.toString() 
      : 'no-driver';
    
    if (!grouped[driverId]) {
      // Use driver.groupLabel if set, otherwise default to driver.name
      let groupLabel = 'No Driver';
      if (load.driver_id) {
        groupLabel = load.driver_id.groupLabel || load.driver_id.name;
      }
      
      grouped[driverId] = {
        groupLabel: groupLabel,
        groupRate: `${defaultRate}%`,
        lines: []
      };
    }

    const price = Number(load.carrier_pay || 0);
    const ratePercent = `${defaultRate}%`;

    // Dispatcher fee (commission) is price * (rate/100).
    // Example: $2000 @ 5% => $100
    const rateDecimal = Number(defaultRate || 0) / 100;
    const amount = price * rateDecimal;

    subtotal += amount;

    grouped[driverId].lines.push({
      loadNumber: (load.load_number || '').toString(),
      pickupDate: formatDate(load.pickup_date),
      deliveryDate: formatDate(load.delivery_date),
      originCityState: `${load.pickup_city || ''}, ${load.pickup_state || ''}`,
      destCityState: `${load.delivery_city || ''}, ${load.delivery_state || ''}`,
      price: price.toFixed(2),
      ratePercent: ratePercent,
      amount: amount.toFixed(2)
    });
  }

  // Prepare template data
  const postage = invoiceData.postage || 0;
  const total = subtotal + postage;
  
  const templateData = {
    invoiceNumber: invoiceData.invoiceNumber || `INV-${Date.now()}`,
    invoiceDate: formatDate(invoiceData.invoiceDate || new Date()),
    dueDate: formatDate(invoiceData.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
    balanceDue: total.toFixed(2),
    billToName: billTo.name || invoiceData.billToName || 'Customer Name',
    billToCityStateZip: billTo.cityStateZip || invoiceData.billToCityStateZip || 'City, State ZIP',
    billToPhone: billTo.phone || invoiceData.billToPhone || 'Phone',
    payableToName: activeDispatcher.payableTo?.name || invoiceData.payableToName || 'Your Company Name',
    payableToCityStateZip: activeDispatcher.payableTo?.cityStateZip || invoiceData.payableToCityStateZip || 'City, State ZIP',
    payableToPhone: activeDispatcher.payableTo?.phone || invoiceData.payableToPhone || 'Phone',
    groups: Object.values(grouped),
    subtotal: subtotal.toFixed(2),
    postage: postage.toFixed(2),
    total: total.toFixed(2),
    cta: invoiceData.cta || 'Thank you for your business',
    paymentLine: invoiceData.paymentLine || 'Payment due within 30 days'
  };

  // Return template data for invoice storage
  templateData._invoiceData = {
    invoiceDate: invoiceData.invoiceDate || new Date(),
    dueDate: invoiceData.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    billTo: {
      name: templateData.billToName,
      cityStateZip: templateData.billToCityStateZip,
      phone: templateData.billToPhone
    },
    payableTo: {
      name: templateData.payableToName,
      cityStateZip: templateData.payableToCityStateZip,
      phone: templateData.payableToPhone
    },
    subtotal: subtotal,
    postage: postage,
    total: total,
    balanceDue: total,
    cta: templateData.cta,
    paymentLine: templateData.paymentLine,
    groups: Object.values(grouped)
  };

  // Read and compile template
  const templatePath = path.join(__dirname, '../templates/invoice.html');
  const templateContent = fs.readFileSync(templatePath, 'utf8');
  const template = handlebars.compile(templateContent);
  const html = template(templateData);

  // Generate PDF using Playwright
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  await page.setContent(html, { waitUntil: 'networkidle' });

  // Ensure invoices directory exists
  const invoicesDir = '/app/invoices';
  if (!fs.existsSync(invoicesDir)) {
    fs.mkdirSync(invoicesDir, { recursive: true });
  }

  // Filename format: "{Carrier name} invoice {ending monday date}"
  // endingMonday is expected to be an ISO date string "YYYY-MM-DD" (passed from invoice generation).
  const carrierName = carrier?.name || 'Carrier';
  const endingMonday = invoiceData?.endingMonday || '';
  const preferredBaseName = `${carrierName} invoice ${endingMonday}`.trim();
  const pdfPath = uniquePdfPath(invoicesDir, preferredBaseName || templateData.invoiceNumber);
  
  await page.pdf({
    path: pdfPath,
    format: 'Letter',
    margin: {
      top: '0.6in',
      right: '0.6in',
      bottom: '0.6in',
      left: '0.6in'
    },
    printBackground: true
  });

  await browser.close();

  // Return both PDF path and invoice data for storage
  return {
    pdfPath: pdfPath,
    invoiceData: templateData._invoiceData
  };
}

/**
 * Format date to MM/DD/YYYY
 * @param {Date} date - Date object
 * @returns {string} Formatted date string
 */
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

module.exports = {
  generateInvoicePDF,
  formatDate
};

