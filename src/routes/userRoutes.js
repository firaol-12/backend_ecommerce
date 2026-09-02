const express = require('express');
const router = express.Router();

const { query } = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sanitizeUser } = require('../utils/helpers');

router.get('/profile', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, first_name, last_name, email, phone, avatar, role, is_active, created_at, updated_at
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.json({ user: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load profile', error: error.message });
  }
});

router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { first_name, last_name, phone, avatar } = req.body;
    const result = await query(
      `UPDATE users
       SET first_name = COALESCE($1, first_name),
           last_name = COALESCE($2, last_name),
           phone = COALESCE($3, phone),
           avatar = COALESCE($4, avatar),
           updated_at = NOW()
       WHERE id = $5
       RETURNING id, first_name, last_name, email, phone, avatar, role, is_active, created_at, updated_at`,
      [first_name || null, last_name || null, phone || null, avatar || null, req.user.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.json({ message: 'Profile updated', user: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Update failed', error: error.message });
  }
});

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, first_name, last_name, email, phone, avatar, role, is_active, created_at, updated_at
       FROM users
       ORDER BY created_at DESC`
    );

    return res.json({ users: result.rows.map(sanitizeUser) });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch users', error: error.message });
  }
});

router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, first_name, last_name, email, phone, avatar, role, is_active, created_at, updated_at
       FROM users WHERE id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.json({ user: sanitizeUser(result.rows[0]) });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch user', error: error.message });
  }
});

router.patch('/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { is_active, role } = req.body;

    const result = await query(
      `UPDATE users
       SET is_active = COALESCE($1, is_active),
           role = COALESCE($2, role),
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, first_name, last_name, email, phone, avatar, role, is_active, created_at, updated_at`,
      [is_active !== undefined ? Boolean(is_active) : null, role || null, req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.json({ message: 'User status updated', user: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update user', error: error.message });
  }
});

module.exports = router;
