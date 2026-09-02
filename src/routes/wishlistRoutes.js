const express = require('express');
const router = express.Router();

const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT w.*, p.name, p.price,
              COALESCE((SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id AND pi.is_main_image = TRUE LIMIT 1), '') AS image_url
       FROM wishlist w
       JOIN products p ON p.id = w.product_id
       WHERE w.user_id = $1
       ORDER BY w.added_at DESC`,
      [req.user.userId]
    );
    return res.json({ wishlist: result.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch wishlist', error: error.message });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { product_id } = req.body;
    if (!product_id) {
      return res.status(400).json({ message: 'product_id is required.' });
    }

    const existing = await query(
      'SELECT * FROM wishlist WHERE user_id = $1 AND product_id = $2',
      [req.user.userId, product_id]
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ message: 'Product is already in wishlist.' });
    }

    const result = await query(
      `INSERT INTO wishlist (user_id, product_id)
       VALUES ($1, $2)
       RETURNING *`,
      [req.user.userId, product_id]
    );

    return res.status(201).json({ message: 'Saved to wishlist', item: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to add to wishlist', error: error.message });
  }
});

router.delete('/:productId', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2 RETURNING *',
      [req.user.userId, req.params.productId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Wishlist item not found.' });
    }

    return res.json({ message: 'Removed from wishlist' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to remove from wishlist', error: error.message });
  }
});

module.exports = router;
