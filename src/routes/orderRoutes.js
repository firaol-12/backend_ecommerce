const express = require('express');
const router = express.Router();

const { query } = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

function generateOrderNumber() {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${timestamp}-${random}`;
}

router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const { shipping_address_id, billing_address_id, shipping_method, notes, coupon_code } = req.body;

    if (!shipping_address_id || !billing_address_id) {
      return res.status(400).json({ message: 'shipping_address_id and billing_address_id are required.' });
    }

    const cartItems = await query(
      `SELECT c.*, p.name, p.price, p.discount, p.stock
       FROM cart c
       JOIN products p ON p.id = c.product_id
       WHERE c.user_id = $1`,
      [req.user.userId]
    );

    if (cartItems.rowCount === 0) {
      return res.status(400).json({ message: 'Cart is empty.' });
    }

    let subtotal = 0;
    for (const item of cartItems.rows) {
      const itemPrice = Number(item.price) * (1 - Number(item.discount || 0) / 100);
      subtotal += itemPrice * Number(item.quantity);
    }

    let discountAmount = 0;
    if (coupon_code) {
      const couponResult = await query(
        `SELECT * FROM coupons WHERE code = $1 AND is_active = TRUE AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE`,
        [coupon_code]
      );

      if (couponResult.rowCount > 0) {
        const coupon = couponResult.rows[0];
        if (coupon.discount_type === 'percentage') {
          discountAmount = Math.min((subtotal * Number(coupon.discount_value)) / 100, Number(coupon.max_discount || subtotal));
        } else {
          discountAmount = Number(coupon.discount_value);
        }
      }
    }

    const shippingCost = 0;
    const taxAmount = subtotal * 0.08;
    const totalAmount = subtotal + shippingCost + taxAmount - discountAmount;

    const orderResult = await query(
      `INSERT INTO orders (
        order_number, user_id, shipping_address_id, billing_address_id,
        subtotal, shipping_cost, tax_amount, discount_amount, total_amount,
        shipping_method, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [generateOrderNumber(), req.user.userId, shipping_address_id, billing_address_id, subtotal.toFixed(2), shippingCost.toFixed(2), taxAmount.toFixed(2), discountAmount.toFixed(2), totalAmount.toFixed(2), shipping_method || null, notes || null]
    );

    const order = orderResult.rows[0];

    for (const item of cartItems.rows) {
      const itemPrice = Number(item.price) * (1 - Number(item.discount || 0) / 100);
      await query(
        `INSERT INTO order_items (order_id, product_id, product_name, product_image, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [order.id, item.product_id, item.name, '', Number(item.quantity), itemPrice.toFixed(2), (itemPrice * Number(item.quantity)).toFixed(2)]
      );

      await query(
        `UPDATE products SET stock = stock - $1, view_count = view_count + 1 WHERE id = $2`,
        [Number(item.quantity), item.product_id]
      );
    }

    await query(
      `INSERT INTO payments (order_id, amount, payment_method, status)
       VALUES ($1, $2, $3, 'pending')`,
      [order.id, totalAmount.toFixed(2), 'credit_card']
    );

    await query('DELETE FROM cart WHERE user_id = $1', [req.user.userId]);

    return res.status(201).json({ message: 'Order created successfully', order });
  } catch (error) {
    return res.status(500).json({ message: 'Order checkout failed', error: error.message });
  }
});

router.get('/my', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.userId]
    );
    return res.json({ orders: result.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch user orders', error: error.message });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const orderResult = await query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (orderResult.rowCount === 0) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    const order = orderResult.rows[0];
    if (req.user.role !== 'admin' && order.user_id !== req.user.userId) {
      return res.status(403).json({ message: 'Not allowed to access this order.' });
    }

    const itemsResult = await query('SELECT * FROM order_items WHERE order_id = $1', [req.params.id]);
    const paymentsResult = await query('SELECT * FROM payments WHERE order_id = $1', [req.params.id]);

    return res.json({ order, items: itemsResult.rows, payments: paymentsResult.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch order', error: error.message });
  }
});

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await query('SELECT * FROM orders ORDER BY created_at DESC');
    return res.json({ orders: result.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch orders', error: error.message });
  }
});

router.patch('/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, payment_status, tracking_number } = req.body;
    const result = await query(
      `UPDATE orders
       SET status = COALESCE($1, status),
           payment_status = COALESCE($2, payment_status),
           tracking_number = COALESCE($3, tracking_number),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status || null, payment_status || null, tracking_number || null, req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    return res.json({ message: 'Order updated successfully', order: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update order status', error: error.message });
  }
});

module.exports = router;
