const express = require('express');
const router = express.Router();

const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

router.get('/product/:productId', async (req, res) => {
  try {
    const result = await query(
      `SELECT r.*, u.first_name, u.last_name
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.product_id = $1
       ORDER BY r.created_at DESC`,
      [req.params.productId]
    );
    return res.json({ reviews: result.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch reviews', error: error.message });
  }
});

router.post('/product/:productId', requireAuth, async (req, res) => {
  try {
    const { rating, title, content, is_verified_purchase = false } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
    }

    const result = await query(
      `INSERT INTO reviews (product_id, user_id, rating, title, content, is_verified_purchase)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.params.productId, req.user.userId, Number(rating), title || null, content || null, Boolean(is_verified_purchase)]
    );

    const stats = await query(
      `SELECT ROUND(AVG(rating), 2) AS avg_rating, COUNT(*) AS rating_count
       FROM reviews WHERE product_id = $1`,
      [req.params.productId]
    );

    await query(
      `UPDATE products
       SET rating = $1,
           rating_count = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [Number(stats.rows[0].avg_rating || 0), Number(stats.rows[0].rating_count || 0), req.params.productId]
    );

    return res.status(201).json({ message: 'Review created successfully', review: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create review', error: error.message });
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { rating, title, content, is_approved } = req.body;
    const existing = await query('SELECT * FROM reviews WHERE id = $1', [req.params.id]);

    if (existing.rowCount === 0) {
      return res.status(404).json({ message: 'Review not found.' });
    }

    if (existing.rows[0].user_id !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'You cannot edit this review.' });
    }

    const result = await query(
      `UPDATE reviews
       SET rating = COALESCE($1, rating),
           title = COALESCE($2, title),
           content = COALESCE($3, content),
           is_approved = COALESCE($4, is_approved),
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [rating !== undefined ? Number(rating) : null, title !== undefined ? title : null, content !== undefined ? content : null, is_approved !== undefined ? is_approved : null, req.params.id]
    );

    return res.json({ message: 'Review updated successfully', review: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update review', error: error.message });
  }
});

router.get('/my', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM reviews WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );
    return res.json({ reviews: result.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch your reviews', error: error.message });
  }
});

module.exports = router;
