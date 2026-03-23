const mongoose = require('mongoose');

// MongoDB connection
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://mongodb:27017/invoicing';
    await mongoose.connect(mongoURI);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Load Schema
const loadSchema = new mongoose.Schema({
  carrier_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Carrier',
    required: false,
    default: null
  },
  carrier_raw_extracted: {
    type: String,
    trim: true
  },
  carrier_source: {
    type: String,
    enum: ['ocr', 'alias', 'manual'],
    default: 'ocr'
  },
  needs_review: {
    type: Boolean,
    default: false
  },
  review_reason: {
    type: String,
    trim: true
  },
  driver_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    required: false
  },
  load_number: {
    type: String,
    required: true
  },
  carrier_pay: {
    type: Number,
    required: true
  },
  pickup_date: {
    type: Date,
    required: true
  },
  delivery_date: {
    type: Date,
    required: true
  },
  // Auto-assigned invoice week fields (derived from pickup_date + delivery_date)
  // invoice_monday is stored as UTC midnight datetime.
  invoice_monday: {
    type: Date,
    required: false,
    default: null,
    index: true
  },
  // invoice_week_id is YYYY-MM-DD (same date as invoice_monday, UTC).
  invoice_week_id: {
    type: String,
    required: false,
    default: null,
    index: true
  },
  pickup_city: {
    type: String,
    required: true
  },
  pickup_state: {
    type: String,
    required: true
  },
  delivery_city: {
    type: String,
    required: true
  },
  delivery_state: {
    type: String,
    required: true
  },
  pdf_filename: {
    type: String,
    required: true
  },
  rate_confirmation_path: {
    type: String,
    required: false,
    default: null,
    trim: true
  },
  cancelled: {
    type: Boolean,
    default: false
  },
  confirmed: {
    type: Boolean,
    default: false
  },
  invoiced: {
    type: Boolean,
    default: false,
    index: true
  },
  date_conflict_ids: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Load'
  }],
  // Driver conflicts are informational only (never block saving/assignment).
  // A conflict exists iff [pickup, delivery) intervals overlap with another load for the same driver.
  driver_conflict: {
    type: Boolean,
    default: false
  },
  driver_conflict_ids: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Load'
  }],
  // Duplicate load number conflicts are informational only (never block saving/assignment).
  // A conflict exists when two (or more) non-cancelled loads share the same carrier_id + load_number.
  duplicate_conflict: {
    type: Boolean,
    default: false
  },
  duplicate_conflict_ids: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Load'
  }],
  sub_dispatcher_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dispatcher',
    default: null
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

// Carrier Schema
const carrierSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  aliases: [{
    type: String,
    trim: true
  }],
  billTo: {
    name: { type: String, trim: true },
    cityStateZip: { type: String, trim: true },
    phone: { type: String, trim: true }
  },
  driver_ids: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver'
  }],
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
});

// Update updated_at on save
carrierSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

// Driver Schema
const driverSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  aliases: [{
    type: String,
    trim: true
  }],
  groupLabel: {
    type: String,
    trim: true,
    required: false
  },
  color: {
    type: String,
    trim: true,
    required: false,
    default: null
  },
  carrier_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Carrier',
    required: true
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
});

// Update updated_at on save
driverSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

// Invoice Rules Schema
const invoiceRuleSchema = new mongoose.Schema({
  rule_name: {
    type: String,
    required: true
  },
  earliest_pickup_date: {
    type: Date,
    required: false
  },
  latest_delivery_date: {
    type: Date,
    required: false
  },
  carrier_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Carrier',
    required: false
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

// Settings Schema (for global application settings)
const settingsSchema = new mongoose.Schema({
  defaultRate: {
    type: Number,
    default: 5.0 // Default 5% rate
  },
  billTo: {
    name: { type: String, trim: true },
    cityStateZip: { type: String, trim: true },
    phone: { type: String, trim: true }
  },
  hideInvoicedLoads: {
    type: Boolean,
    default: false
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, {
  // Only allow one settings document
  collection: 'settings'
});

// Update updated_at on save
settingsSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

// Carrier Alias Schema
const carrierAliasSchema = new mongoose.Schema({
  alias_raw: {
    type: String,
    required: true,
    trim: true
  },
  alias_normalized: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  carrier_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Carrier',
    required: true
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

// Dispatcher Schema
const dispatcherSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  payableTo: {
    name: { type: String, trim: true },
    cityStateZip: { type: String, trim: true },
    phone: { type: String, trim: true }
  },
  isActive: {
    type: Boolean,
    default: false
  },
  parent_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dispatcher',
    default: null
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
});

// Update updated_at on save
dispatcherSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

// Invoices Schema
const invoiceSchema = new mongoose.Schema({
  invoice_number: {
    type: String,
    required: true,
    unique: true
  },
  load_ids: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Load'
  }],
  generated_at: {
    type: Date,
    default: Date.now
  },
  pdf_path: {
    type: String,
    required: true
  },
  invoiceDate: {
    type: Date
  },
  dueDate: {
    type: Date
  },
  billTo: {
    name: { type: String, trim: true },
    cityStateZip: { type: String, trim: true },
    phone: { type: String, trim: true }
  },
  payableTo: {
    name: { type: String, trim: true },
    cityStateZip: { type: String, trim: true },
    phone: { type: String, trim: true }
  },
  subtotal: {
    type: Number,
    default: 0
  },
  postage: {
    type: Number,
    default: 0
  },
  total: {
    type: Number,
    default: 0
  },
  balanceDue: {
    type: Number,
    default: 0
  },
  paid: {
    type: Boolean,
    default: false
  },
  paid_date: {
    type: Date,
    default: null
  },
  cta: {
    type: String,
    trim: true
  },
  paymentLine: {
    type: String,
    trim: true
  },
  groups: [{
    groupLabel: String,
    groupRate: String,
    lines: [{
      pickupDate: String,
      deliveryDate: String,
      originCityState: String,
      destCityState: String,
      price: String,
      ratePercent: String,
      amount: String
    }]
  }],
  // For uploaded old invoices (no load_ids): carrier name parsed from filename
  carrier_name: {
    type: String,
    trim: true,
    default: null
  }
});

// Create models
const Load = mongoose.model('Load', loadSchema);
const Carrier = mongoose.model('Carrier', carrierSchema);
const Driver = mongoose.model('Driver', driverSchema);
const InvoiceRule = mongoose.model('InvoiceRule', invoiceRuleSchema);
const Invoice = mongoose.model('Invoice', invoiceSchema);
const Dispatcher = mongoose.model('Dispatcher', dispatcherSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const CarrierAlias = mongoose.model('CarrierAlias', carrierAliasSchema);

module.exports = {
  connectDB,
  Load,
  Carrier,
  Driver,
  InvoiceRule,
  Invoice,
  Dispatcher,
  Settings,
  CarrierAlias
};

