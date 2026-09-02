const express = require('express');
const router = express.Router();

const { query } = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/dashboard', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [users, products, orders, revenue] = await Promise.all([
      query('SELECT COUNT(*) AS total FROM users'),
      query('SELECT COUNT(*) AS total FROM products'),
      query('SELECT COUNT(*) AS total FROM orders'),
      query('SELECT COALESCE(SUM(total_amount), 0) AS total FROM orders WHERE status != $1', ['cancelled'])
    ]);

    const recentOrders = await query(
      'SELECT * FROM orders ORDER BY created_at DESC LIMIT 10'
    );

    return res.json({
      summary: {
        users: Number(users.rows[0].total),
        products: Number(products.rows[0].total),
        orders: Number(orders.rows[0].total),
        revenue: Number(revenue.rows[0].total),
      },
      recentOrders: recentOrders.rows,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load admin dashboard', error: error.message });
  }
});

module.exports = router;
