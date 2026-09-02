const express = require('express');
const router = express.Router();

const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
      [req.user.userId]
    );
    return res.json({ addresses: result.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch addresses', error: error.message });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      full_name,
      phone,
      street,
      city,
      state,
      postal_code,
      country,
      address_type,
      is_default = false,
    } = req.body;

    if (!full_name || !phone || !street || !city || !state || !postal_code || !country || !address_type) {
      return res.status(400).json({ message: 'All address fields are required.' });
    }

    if (is_default) {
      await query(
        `UPDATE addresses SET is_default = FALSE WHERE user_id = $1 AND address_type = $2`,
        [req.user.userId, address_type]
      );
    }

    const result = await query(
      `INSERT INTO addresses (user_id, full_name, phone, street, city, state, postal_code, country, address_type, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [req.user.userId, full_name, phone, street, city, state, postal_code, country, address_type, Boolean(is_default)]
    );

    return res.status(201).json({ message: 'Address added', address: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create address', error: error.message });
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { full_name, phone, street, city, state, postal_code, country, address_type, is_default } = req.body;

    if (is_default) {
      await query(
        `UPDATE addresses SET is_default = FALSE WHERE user_id = $1 AND address_type = $2`,
        [req.user.userId, address_type || 'shipping']
      );
    }

    const result = await query(
      `UPDATE addresses
       SET full_name = COALESCE($1, full_name),
           phone = COALESCE($2, phone),
           street = COALESCE($3, street),
           city = COALESCE($4, city),
           state = COALESCE($5, state),
           postal_code = COALESCE($6, postal_code),
           country = COALESCE($7, country),
           address_type = COALESCE($8, address_type),
           is_default = COALESCE($9, is_default),
           updated_at = NOW()
       WHERE id = $10 AND user_id = $11
       RETURNING *`,
      [full_name || null, phone || null, street || null, city || null, state || null, postal_code || null, country || null, address_type || null, is_default !== undefined ? Boolean(is_default) : null, req.params.id, req.user.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Address not found.' });
    }

    return res.json({ message: 'Address updated', address: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update address', error: error.message });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.user.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Address not found.' });
    }

    return res.json({ message: 'Address deleted' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete address', error: error.message });
  }
});

module.exports = router;
