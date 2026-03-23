const express = require('express');
const cors = require('cors');
const session = require('express-session');
require('dotenv').config();
const { connectDB } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow localhost and the server IP
    const allowedOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      process.env.FRONTEND_URL
    ].filter(Boolean);
    
    // Also allow any origin that matches the pattern (for development)
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all in development
    }
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'invoicing-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 * 30 // 30 days
  }
}));

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
};

// Public routes
app.use('/api/auth', require('./routes/auth'));

// Protected routes (require authentication)
app.use('/api/upload', requireAuth, require('./routes/upload'));
app.use('/api/loads', requireAuth, require('./routes/loads'));
app.use('/api/carriers', requireAuth, require('./routes/carriers'));
app.use('/api/drivers', requireAuth, require('./routes/drivers'));
app.use('/api/rules', requireAuth, require('./routes/rules'));
app.use('/api/invoices', requireAuth, require('./routes/invoices'));
app.use('/api/dispatchers', requireAuth, require('./routes/dispatchers'));
app.use('/api/settings', requireAuth, require('./routes/settings'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on port ${PORT}`);
});

