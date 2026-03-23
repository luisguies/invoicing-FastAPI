const express = require('express');
const router = express.Router();

// Login endpoint
router.post('/login', (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.LOGIN_PASSWORD;

  if (!correctPassword) {
    return res.status(500).json({ error: 'Login password not configured. Please set LOGIN_PASSWORD in .env file.' });
  }

  if (password === correctPassword) {
    // Set session or token
    req.session.authenticated = true;
    res.json({ success: true, message: 'Login successful' });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Logout endpoint
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Check authentication status
router.get('/check', (req, res) => {
  if (req.session && req.session.authenticated) {
    res.json({ authenticated: true });
  } else {
    res.json({ authenticated: false });
  }
});

module.exports = router;

