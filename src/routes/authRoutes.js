const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

const { query } = require('../config/db');
const { sanitizeUser } = require('../utils/helpers');
const { requireAuth } = require('../middleware/auth');

function generateToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET || 'change-me',
    { expiresIn: '7d' }
  );
}

router.post('/register', async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      password,
      phone,
      avatar,
    } = req.body;

    if (!first_name || !last_name || !email || !password) {
      return res.status(400).json({ message: 'first_name, last_name, email and password are required.' });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ message: 'User already exists with this email.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (first_name, last_name, email, password, phone, avatar)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, first_name, last_name, email, phone, avatar, role, is_active, created_at, updated_at`,
      [first_name.trim(), last_name.trim(), email.trim().toLowerCase(), hashedPassword, phone || null, avatar || null]
    );

    const user = result.rows[0];
    const token = generateToken({ ...user, role: 'customer' });

    return res.status(201).json({
      message: 'User registered successfully',
      user: sanitizeUser({ ...user, role: 'customer' }),
      token,
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ message: 'Failed to register user', error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const result = await query(
      'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
      [String(email).trim().toLowerCase()]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = generateToken(user);

    return res.json({
      message: 'Login successful',
      user: sanitizeUser(user),
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Failed to login', error: error.message });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, first_name, last_name, email, phone, avatar, role, is_active, created_at, updated_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get me error:', error);
    return res.status(500).json({ message: 'Unable to fetch user profile', error: error.message });
  }
});

module.exports = router;
