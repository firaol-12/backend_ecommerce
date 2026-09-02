const express = require('express');
const router = express.Router();

const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT c.*, p.name AS product_name, p.price, p.discount,
              COALESCE((SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id AND pi.is_main_image = TRUE LIMIT 1), '') AS image_url
       FROM cart c
       JOIN products p ON p.id = c.product_id
       WHERE c.user_id = $1
       ORDER BY c.added_at DESC`,
      [req.user.userId]
    );

    return res.json({ cart: result.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch cart', error: error.message });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { product_id, quantity = 1 } = req.body;
    if (!product_id) {
      return res.status(400).json({ message: 'product_id is required.' });
    }

    const existing = await query(
      'SELECT * FROM cart WHERE user_id = $1 AND product_id = $2',
      [req.user.userId, product_id]
    );

    if (existing.rowCount > 0) {
      const updated = await query(
        `UPDATE cart
         SET quantity = quantity + $1,
             updated_at = NOW()
         WHERE user_id = $2 AND product_id = $3
         RETURNING *`,
        [Number(quantity), req.user.userId, product_id]
      );
      return res.json({ message: 'Cart item updated', item: updated.rows[0] });
    }

    const result = await query(
      `INSERT INTO cart (user_id, product_id, quantity)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.user.userId, product_id, Number(quantity)]
    );

    return res.status(201).json({ message: 'Item added to cart', item: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to add item to cart', error: error.message });
  }
});

router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { quantity } = req.body;
    const result = await query(
      `UPDATE cart
       SET quantity = $1,
           updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [Number(quantity), req.params.id, req.user.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Cart item not found.' });
    }

    return res.json({ message: 'Cart item updated', item: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update cart item', error: error.message });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM cart WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.user.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Cart item not found.' });
    }

    return res.json({ message: 'Cart item removed' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to remove cart item', error: error.message });
  }
});

module.exports = router;
