const pool = require('../config/db');

// GET /api/users/me
async function getProfile(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, avatar_url, role, created_at 
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// PUT /api/users/me
async function updateProfile(req, res) {
  const { name, phone, avatarUrl } = req.body;

  try {
    const result = await pool.query(
      `UPDATE users 
       SET name = COALESCE($1, name), 
           phone = COALESCE($2, phone), 
           avatar_url = COALESCE($3, avatar_url),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, name, email, phone, avatar_url, role`,
      [name, phone, avatarUrl, req.user.userId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// GET /api/users/me/addresses
async function getAddresses(req, res) {
  try {
    const result = await pool.query(
      'SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC',
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// POST /api/users/me/addresses
async function addAddress(req, res) {
  const { label, fullName, phone, line1, line2, city, state, country, postalCode, isDefault } = req.body;

  if (!fullName || !phone || !line1 || !city || !state || !country || !postalCode) {
    return res.status(400).json({ error: 'Missing required address fields' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO addresses 
        (user_id, label, full_name, phone, line1, line2, city, state, country, postal_code, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [req.user.userId, label, fullName, phone, line1, line2, city, state, country, postalCode, !!isDefault]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// PUT /api/users/me/addresses/:id
async function updateAddress(req, res) {
  const { id } = req.params;
  const { label, fullName, phone, line1, line2, city, state, country, postalCode, isDefault } = req.body;

  try {
    // Make sure this address belongs to the logged-in user
    const check = await pool.query(
      'SELECT id FROM addresses WHERE id = $1 AND user_id = $2',
      [id, req.user.userId]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Address not found' });
    }

    const result = await pool.query(
      `UPDATE addresses SET
        label = COALESCE($1, label),
        full_name = COALESCE($2, full_name),
        phone = COALESCE($3, phone),
        line1 = COALESCE($4, line1),
        line2 = COALESCE($5, line2),
        city = COALESCE($6, city),
        state = COALESCE($7, state),
        country = COALESCE($8, country),
        postal_code = COALESCE($9, postal_code),
        is_default = COALESCE($10, is_default)
       WHERE id = $11
       RETURNING *`,
      [label, fullName, phone, line1, line2, city, state, country, postalCode, isDefault, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// DELETE /api/users/me/addresses/:id
async function deleteAddress(req, res) {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Address not found' });
    }

    res.json({ message: 'Address deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

module.exports = {
  getProfile,
  updateProfile,
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
};