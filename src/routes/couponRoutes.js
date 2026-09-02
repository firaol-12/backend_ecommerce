const express = require('express');
const router = express.Router();

const { query } = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await query('SELECT * FROM coupons ORDER BY created_at DESC');
    return res.json({ coupons: result.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch coupons', error: error.message });
  }
});

router.post('/validate', requireAuth, async (req, res) => {
  try {
    const { code, subtotal } = req.body;
    if (!code) {
      return res.status(400).json({ message: 'Coupon code is required.' });
    }

    const result = await query(
      `SELECT * FROM coupons
       WHERE code = $1 AND is_active = TRUE
         AND start_date <= CURRENT_DATE
         AND end_date >= CURRENT_DATE`,
      [code]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Coupon not found or expired.' });
    }

    const coupon = result.rows[0];
    const numericSubtotal = Number(subtotal || 0);

    if (coupon.min_order_amount && numericSubtotal < Number(coupon.min_order_amount)) {
      return res.status(400).json({ message: `Minimum order amount for this coupon is ${coupon.min_order_amount}.` });
    }

    const discount = coupon.discount_type === 'percentage'
      ? Math.min((numericSubtotal * Number(coupon.discount_value)) / 100, Number(coupon.max_discount || numericSubtotal))
      : Number(coupon.discount_value);

    return res.json({ valid: true, coupon, discount });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to validate coupon', error: error.message });
  }
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      code,
      description,
      discount_type,
      discount_value,
      max_discount,
      min_order_amount,
      usage_limit,
      per_user_limit,
      start_date,
      end_date,
      is_active = true,
      applicable_categories,
    } = req.body;

    if (!code || !discount_type || !discount_value || !start_date || !end_date) {
      return res.status(400).json({ message: 'code, discount_type, discount_value, start_date and end_date are required.' });
    }

    const result = await query(
      `INSERT INTO coupons (
        code, description, discount_type, discount_value, max_discount,
        min_order_amount, usage_limit, per_user_limit, start_date,
        end_date, is_active, applicable_categories
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [code, description || null, discount_type, Number(discount_value), max_discount !== undefined ? Number(max_discount) : null, min_order_amount !== undefined ? Number(min_order_amount) : null, usage_limit !== undefined ? Number(usage_limit) : null, Number(per_user_limit || 1), start_date, end_date, Boolean(is_active), applicable_categories || null]
    );

    return res.status(201).json({ message: 'Coupon created successfully', coupon: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create coupon', error: error.message });
  }
});

module.exports = router;
