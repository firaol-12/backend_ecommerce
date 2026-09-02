const pool = require('../config/db');
const generateOrderNumber = require('../utils/generateOrderNumber');

// POST /api/orders/checkout
async function checkout(req, res) {
  const { shippingAddressId, billingAddressId } = req.body;
  const userId = req.user.userId;

  if (!shippingAddressId || !billingAddressId) {
    return res.status(400).json({ error: 'Shipping and billing address are required' });
  }

  // Use a transaction: either everything succeeds, or nothing does
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Get the user's cart
    const cartResult = await client.query('SELECT * FROM carts WHERE user_id = $1', [userId]);
    if (cartResult.rows.length === 0) {
      throw { status: 400, message: 'Cart is empty' };
    }
    const cart = cartResult.rows[0];

    // 2. Get cart items with current variant price/stock
    const itemsResult = await client.query(
      `SELECT ci.id, ci.quantity, ci.product_variant_id,
              pv.price, pv.stock_quantity, p.name AS product_name, p.base_price
       FROM cart_items ci
       JOIN product_variants pv ON ci.product_variant_id = pv.id
       JOIN products p ON pv.product_id = p.id
       WHERE ci.cart_id = $1`,
      [cart.id]
    );

    if (itemsResult.rows.length === 0) {
      throw { status: 400, message: 'Cart is empty' };
    }

    // 3. Check stock and calculate subtotal
    let subtotal = 0;
    for (const item of itemsResult.rows) {
      if (item.stock_quantity < item.quantity) {
        throw { status: 400, message: `Not enough stock for ${item.product_name}` };
      }
      const price = item.price || item.base_price;
      subtotal += price * item.quantity;
    }

    const shippingFee = 5.0; // flat rate — customize later
    const tax = +(subtotal * 0.1).toFixed(2); // 10% tax — customize later
    const total = +(subtotal + shippingFee + tax).toFixed(2);

    // 4. Create the order
    const orderNumber = generateOrderNumber();
    const orderResult = await client.query(
      `INSERT INTO orders 
        (order_number, user_id, status, subtotal, shipping_fee, tax, total, 
         shipping_address_id, billing_address_id, payment_status)
       VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, 'unpaid')
       RETURNING *`,
      [orderNumber, userId, subtotal, shippingFee, tax, total, shippingAddressId, billingAddressId]
    );
    const order = orderResult.rows[0];

    // 5. Create order_items (snapshotting name/price) and reduce stock
    for (const item of itemsResult.rows) {
      const price = item.price || item.base_price;

      await client.query(
        `INSERT INTO order_items (order_id, product_variant_id, product_name, price, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, item.product_variant_id, item.product_name, price, item.quantity]
      );

      await client.query(
        `UPDATE product_variants SET stock_quantity = stock_quantity - $1 WHERE id = $2`,
        [item.quantity, item.product_variant_id]
      );
    }

    // 6. Clear the cart
    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cart.id]);

    await client.query('COMMIT');

    res.status(201).json(order);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Checkout failed' });
  } finally {
    client.release();
  }
}

// GET /api/orders
async function getMyOrders(req, res) {
  try {
    const result = await pool.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// GET /api/orders/:id
async function getOrderById(req, res) {
  const { id } = req.params;

  try {
    const orderResult = await pool.query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [id, req.user.userId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const itemsResult = await pool.query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [id]
    );

    res.json({ ...orderResult.rows[0], items: itemsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

module.exports = { checkout, getMyOrders, getOrderById };