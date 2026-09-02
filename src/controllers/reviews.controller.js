const pool = require('../config/db');

// GET /api/reviews/product/:productId
async function getReviewsForProduct(req, res) {
  const { productId } = req.params;

  try {
    const result = await pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at,
              u.name AS user_name
       FROM reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.product_id = $1
       ORDER BY r.created_at DESC`,
      [productId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// POST /api/reviews/product/:productId
async function addReview(req, res) {
  const { productId } = req.params;
  const { rating, comment } = req.body;
  const userId = req.user.userId;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }

  try {
    // One review per user per product (matches the UNIQUE constraint in the DB)
    const existing = await pool.query(
      'SELECT id FROM reviews WHERE product_id = $1 AND user_id = $2',
      [productId, userId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'You already reviewed this product' });
    }

    const result = await pool.query(
      `INSERT INTO reviews (product_id, user_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [productId, userId, rating, comment]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// DELETE /api/reviews/:id
async function deleteReview(req, res) {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM reviews WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    res.json({ message: 'Review deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

module.exports = { getReviewsForProduct, addReview, deleteReview };