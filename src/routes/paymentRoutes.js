const express = require('express');
const router = express.Router();

const { query } = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/order/:orderId', requireAuth, async (req, res) => {
  try {
    const result = await query('SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC', [req.params.orderId]);
    return res.json({ payments: result.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch payments', error: error.message });
  }
});

router.post('/order/:orderId', requireAuth, async (req, res) => {
  try {
    const { amount, payment_method, status = 'pending', transaction_id, payment_gateway_response } = req.body;

    const result = await query(
      `INSERT INTO payments (order_id, amount, payment_method, status, transaction_id, payment_gateway_response)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.params.orderId, Number(amount), payment_method || 'credit_card', status, transaction_id || null, payment_gateway_response || null]
    );

    await query(
      `UPDATE orders
       SET payment_status = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [status || 'pending', req.params.orderId]
    );

    return res.status(201).json({ message: 'Payment recorded', payment: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to record payment', error: error.message });
  }
});

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await query('SELECT * FROM payments ORDER BY created_at DESC');
    return res.json({ payments: result.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch all payments', error: error.message });
  }
});

module.exports = router;
