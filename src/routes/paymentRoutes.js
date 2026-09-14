const express = require('express');
const router = express.Router();

const { query, pool } = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// ---------------------------------------------------------------------------
// Chapa (Ethiopian payment gateway) integration
// Docs: https://developer.chapa.co
// ---------------------------------------------------------------------------
const CHAPA_API_URL = (process.env.CHAPA_API_URL || 'https://api.chapa.co').replace(/\/+$/, '');
const CHAPA_SECRET_KEY = process.env.CHAPA_SECRET_KEY || '';
const CHAPA_WEBHOOK_SECRET = process.env.CHAPA_WEBHOOK_SECRET || '';
const CHAPA_TEST_EMAIL = process.env.CHAPA_TEST_EMAIL || '';
const CHAPA_RETURN_BASE_URL = (process.env.CHAPA_CALLBACK_URL || 'http://localhost:3000').replace(/\/+$/, '');

function makeTxRef(userId) {
  return `TRX-${userId}-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function generateOrderNumber() {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${timestamp}-${random}`;
}

// If Chapa setup fails after the order was committed, restore stock and mark
// the order as failed so the customer can retry without inventory loss.
async function voidFailedOrder(orderId) {
  if (!orderId) return;
  try {
    await query(
      `UPDATE products SET stock = stock + q.restored
       FROM (
         SELECT product_id, SUM(quantity) AS restored
         FROM order_items WHERE order_id = $1 GROUP BY product_id
       ) q
       WHERE products.id = q.product_id`,
      [orderId]
    );
    await query(
      `UPDATE orders SET payment_status = 'failed', updated_at = NOW() WHERE id = $1`,
      [orderId]
    );
  } catch (_) { /* best-effort cleanup */ }
}

// Chapa's error "message" may be a plain string or a validation object.
function stringifyGatewayMessage(data) {
  const msg = data && data.message;
  if (typeof msg === 'string') return msg;
  if (msg && typeof msg === 'object') {
    try { return JSON.stringify(msg); } catch (_) { /* fall through */ }
  }
  return 'unknown error';
}

// Build a Chapa-safe email: Chapa rejects test/disposable domains (e.g.
// @test.com). Uses the customer's email if it looks real, otherwise CHAPA_TEST_EMAIL.
function resolveChapaEmail(customer) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const customerEmail = String(customer.email || '').trim().toLowerCase();
  const isValidRealEmail = emailRegex.test(customerEmail) &&
    !/(^|\.)(test|example|sample|dummy|fake|none|unknown)\./i.test(customerEmail) &&
    !customerEmail.endsWith('@test.com');
  const email = isValidRealEmail ? customerEmail : (CHAPA_TEST_EMAIL || customerEmail);
  if (!emailRegex.test(email)) {
    throw new Error('Chapa requires a valid customer email. Set CHAPA_TEST_EMAIL to a real email for testing.');
  }
  return email;
}

// Creates an order from the user's cart, records a pending Chapa payment and
// clears the cart. Runs in a single transaction. Returns the tx_ref, total and
// order reference (no Chapa network call — callers decide how to contact Chapa).
async function createOrderFromCart(userId, body) {
  const { shipping_address_id, billing_address_id, shipping_method, notes, coupon_code } = body || {};

  if (!shipping_address_id || !billing_address_id) {
    const err = new Error('shipping_address_id and billing_address_id are required.');
    err.status = 400;
    throw err;
  }

  // Note: shipping and billing may be the same address, so compare the count
  // of DISTINCT ids rather than raw rows (IN (5, 5) returns one row).
  const addressIds = [...new Set([Number(shipping_address_id), Number(billing_address_id)])];
  const addrResult = await query(
    'SELECT id FROM addresses WHERE id = ANY($1::int[]) AND user_id = $2',
    [addressIds, userId]
  );
  if (addrResult.rowCount !== addressIds.length) {
    const err = new Error('Invalid shipping or billing address.');
    err.status = 400;
    throw err;
  }

  const cart = await computeCartTotal(userId, coupon_code);
  if (!cart.cartItems) {
    const err = new Error('Cart is empty.');
    err.status = 400;
    throw err;
  }

  const txRef = makeTxRef(userId);
  const orderNumber = generateOrderNumber();
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const orderResult = await client.query(
      `INSERT INTO orders (
        order_number, user_id, shipping_address_id, billing_address_id,
        subtotal, shipping_cost, tax_amount, discount_amount, total_amount,
        shipping_method, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [orderNumber, userId, shipping_address_id, billing_address_id, cart.subtotal.toFixed(2), cart.shippingCost.toFixed(2), cart.taxAmount.toFixed(2), cart.discountAmount.toFixed(2), cart.totalAmount.toFixed(2), shipping_method || null, notes || null]
    );
    const order = orderResult.rows[0];
    const orderRef = { id: order.id, order_number: orderNumber, total_amount: cart.totalAmount };

    for (const item of cart.cartItems.rows) {
      const itemPrice = Number(item.price) * (1 - Number(item.discount || 0) / 100);
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, product_image, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [order.id, item.product_id, item.name, '', Number(item.quantity), itemPrice.toFixed(2), (itemPrice * Number(item.quantity)).toFixed(2)]
      );
      await client.query(
        `UPDATE products SET stock = stock - $1, view_count = view_count + 1 WHERE id = $2`,
        [Number(item.quantity), item.product_id]
      );
    }

    await client.query(
      `INSERT INTO payments (order_id, amount, payment_method, status, transaction_id)
       VALUES ($1, $2, 'chapa', 'pending', $3)`,
      [order.id, cart.totalAmount.toFixed(2), txRef]
    );

    await client.query('DELETE FROM cart WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
    return { txRef, totalAmount: cart.totalAmount, orderRef };
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connection may already be closed */ }
    }
    throw error;
  } finally {
    if (client) client.release();
  }
}

async function chapaRequest(path, options = {}) {
  const headers = {
    Authorization: `Bearer ${CHAPA_SECRET_KEY}`,
    ...(options.headers || {}),
  };
  if (options.body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${CHAPA_API_URL}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (networkError) {
    // Surface the real reason instead of a generic failure. The most common
    // causes are an empty/invalid secret key or no network access to Chapa.
    const reason = networkError && networkError.message ? networkError.message : 'network error';
    throw new Error(`Could not connect to Chapa API (${reason})`);
  }

  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function paymentStatusFromChapa(rawStatus) {
  const status = String(rawStatus || '').toLowerCase();
  if (status === 'success' || status === 'completed' || status === 'charge.success') return 'completed';
  if (status === 'failed' || status === 'cancelled' || status.includes('fail') || status.includes('cancel')) return 'failed';
  return 'pending';
}

// Chapa signs webhooks with an HMAC-SHA256 of the transaction reference using
// the Encryption key. If CHAPA_WEBHOOK_SECRET is configured, reject any webhook
// whose signature does not match.
function verifyWebhookSignature(body, txRef) {
  if (!CHAPA_WEBHOOK_SECRET) return true; // verification disabled
  const crypto = require('crypto');
  const expected = crypto.createHmac('sha256', CHAPA_WEBHOOK_SECRET).update(txRef).digest('hex');
  const provided = String(body.signature || body.webhook_signature || '').toLowerCase();
  if (!provided) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
}

// Compute order totals from the current cart (mirrors orderRoutes /checkout).
async function computeCartTotal(userId, couponCode) {
  const cartItems = await query(
    `SELECT c.*, p.name, p.price, p.discount, p.stock
     FROM cart c
     JOIN products p ON p.id = c.product_id
     WHERE c.user_id = $1`,
    [userId]
  );
  if (cartItems.rowCount === 0) {
    return { cartItems: null, subtotal: 0, discountAmount: 0, taxAmount: 0, totalAmount: 0, shippingCost: 0 };
  }

  let subtotal = 0;
  for (const item of cartItems.rows) {
    const itemPrice = Number(item.price) * (1 - Number(item.discount || 0) / 100);
    subtotal += itemPrice * Number(item.quantity);
  }

  let discountAmount = 0;
  if (couponCode) {
    const couponResult = await query(
      `SELECT * FROM coupons WHERE code = $1 AND is_active = TRUE AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE`,
      [couponCode]
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
  const totalAmount = Math.max(0, subtotal + shippingCost + taxAmount - discountAmount);

  return { cartItems, subtotal, discountAmount, taxAmount, totalAmount, shippingCost };
}

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

// Initialize a Chapa payment. Creates the order from the cart, records a pending
// payment and returns Chapa's hosted checkout URL for the browser to open.
router.post('/chapa/initialize', requireAuth, async (req, res) => {
  if (!CHAPA_SECRET_KEY) {
    return res.status(503).json({ message: 'Chapa is not configured. Set CHAPA_SECRET_KEY in the backend environment.' });
  }

  let client;
  let orderRef;
  let totalAmount = 0;
  let txRef;
  const { shipping_address_id, billing_address_id, shipping_method, notes, coupon_code, tx_ref: existingTxRef } = req.body || {};
  const userId = req.user.userId;

  try {
    if (existingTxRef) {
      // Resume flow: /chapa/order already created the order (and cleared the
      // cart). Reuse that pending payment instead of creating a duplicate —
      // re-creating would fail with "Cart is empty".
      const existing = await query(
        `SELECT p.transaction_id, p.amount, o.id AS order_id, o.order_number, o.payment_status
         FROM payments p JOIN orders o ON o.id = p.order_id
         WHERE p.transaction_id = $1 AND o.user_id = $2`,
        [existingTxRef, userId]
      );
      if (existing.rowCount === 0 || existing.rows[0].payment_status !== 'pending') {
        return res.status(404).json({ message: 'No pending payment found for this tx_ref.' });
      }
      txRef = existing.rows[0].transaction_id;
      totalAmount = Number(existing.rows[0].amount);
      orderRef = { id: existing.rows[0].order_id, order_number: existing.rows[0].order_number, total_amount: totalAmount };
    } else {
    if (!shipping_address_id || !billing_address_id) {
      return res.status(400).json({ message: 'shipping_address_id and billing_address_id are required.' });
    }

    // Note: shipping and billing may be the same address, so compare the count
    // of DISTINCT ids rather than raw rows (IN (5, 5) returns one row).
    const addressIds = [...new Set([Number(shipping_address_id), Number(billing_address_id)])];
    const addrResult = await query(
      'SELECT id FROM addresses WHERE id = ANY($1::int[]) AND user_id = $2',
      [addressIds, userId]
    );
    if (addrResult.rowCount !== addressIds.length) {
      return res.status(400).json({ message: 'Invalid shipping or billing address.' });
    }

    const cart = await computeCartTotal(userId, coupon_code);
    if (!cart.cartItems) {
      return res.status(400).json({ message: 'Cart is empty.' });
    }
    totalAmount = cart.totalAmount;
    txRef = makeTxRef(userId);
    const orderNumber = generateOrderNumber();

    client = await pool.connect();
    await client.query('BEGIN');

    const orderResult = await client.query(
      `INSERT INTO orders (
        order_number, user_id, shipping_address_id, billing_address_id,
        subtotal, shipping_cost, tax_amount, discount_amount, total_amount,
        shipping_method, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [orderNumber, userId, shipping_address_id, billing_address_id, cart.subtotal.toFixed(2), cart.shippingCost.toFixed(2), cart.taxAmount.toFixed(2), cart.discountAmount.toFixed(2), totalAmount.toFixed(2), shipping_method || null, notes || null]
    );
    const order = orderResult.rows[0];
    orderRef = { id: order.id, order_number: orderNumber, total_amount: totalAmount };

    for (const item of cart.cartItems.rows) {
      const itemPrice = Number(item.price) * (1 - Number(item.discount || 0) / 100);
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, product_image, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [order.id, item.product_id, item.name, '', Number(item.quantity), itemPrice.toFixed(2), (itemPrice * Number(item.quantity)).toFixed(2)]
      );
      await client.query(
        `UPDATE products SET stock = stock - $1, view_count = view_count + 1 WHERE id = $2`,
        [Number(item.quantity), item.product_id]
      );
    }

    await client.query(
      `INSERT INTO payments (order_id, amount, payment_method, status, transaction_id)
       VALUES ($1, $2, 'chapa', 'pending', $3)`,
      [order.id, totalAmount.toFixed(2), txRef]
    );

    await client.query('DELETE FROM cart WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
    } // end of else (new-order-from-cart branch)
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connection may already be closed */ }
    }
    return res.status(500).json({ message: 'Failed to initialize Chapa payment', error: error.message });
  } finally {
    if (client) client.release();
  }

  // Order + pending payment are safely stored now. Reach out to Chapa.
  try {
    const userId = req.user.userId;
    const userResult = await query('SELECT first_name, last_name, email, phone FROM users WHERE id = $1', [userId]);
    const customer = userResult.rows[0] || {};

    // Chapa rejects test/disposable domains (e.g. @test.com). Build a safe email:
    // use the customer's email if it looks real, otherwise fall back to the
    // CHAPA_TEST_EMAIL override (set it to a real email for local testing).
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const customerEmail = String(customer.email || '').trim().toLowerCase();
    const isValidRealEmail = emailRegex.test(customerEmail) &&
      !/(^|\.)(test|example|sample|dummy|fake|none|unknown)\./i.test(customerEmail) &&
      !customerEmail.endsWith('@test.com');
    const email = isValidRealEmail ? customerEmail : (CHAPA_TEST_EMAIL || customerEmail);
    if (!emailRegex.test(email)) {
      throw new Error('Chapa requires a valid customer email. Set CHAPA_TEST_EMAIL to a real email for testing.');
    }

    const init = await chapaRequest('/v1/transaction/initialize', {
      method: 'POST',
      body: {
        amount: totalAmount.toFixed(2),
        currency: 'ETB',
        email,
        first_name: (customer.first_name || 'Customer').trim().slice(0, 50),
        last_name: (customer.last_name || '').trim().slice(0, 50),
        phone_number: customer.phone ? String(customer.phone) : undefined,
        callback_url: `${CHAPA_RETURN_BASE_URL}/checkout/status`,
        return_url: `${CHAPA_RETURN_BASE_URL}/checkout/status`,
        customization: { title: 'MyShop Order', description: `Order ${orderRef.order_number}` },
        tx_ref: txRef,
      },
    });

    try {
      await query(
        `UPDATE payments SET payment_gateway_response = $1, updated_at = NOW() WHERE transaction_id = $2`,
        [init.data, txRef]
      );
    } catch (_) { /* non-fatal */ }

    if (!init.ok) {
      const gatewayMsg = stringifyGatewayMessage(init.data);
      console.error('[chapa/initialize] Chapa rejected the request:', gatewayMsg, '| tx_ref:', txRef);
      await voidFailedOrder(orderRef && orderRef.id);
      return res.status(502).json({
        message: `Chapa could not initialize the payment (${gatewayMsg}).`,
        tx_ref: txRef, order: orderRef, gateway: init.data,
      });
    }

    const checkoutUrl = init.data && init.data.data && init.data.data.checkout_url;
    if (!checkoutUrl) {
      console.error('[chapa/initialize] Chapa returned no checkout_url | tx_ref:', txRef);
      await voidFailedOrder(orderRef && orderRef.id);
      return res.status(502).json({
        message: 'Chapa did not return a checkout URL.',
        tx_ref: txRef, order: orderRef, gateway: init.data,
      });
    }

    return res.status(201).json({
      message: 'Payment initialized',
      tx_ref: txRef,
      checkout_url: checkoutUrl,
      order: { ...orderRef, payment_status: 'pending' },
    });
  } catch (error) {
    console.error('[chapa/initialize] Chapa setup failed:', error.message, '| tx_ref:', txRef);

    // The order + payment were already committed before we reached Chapa. If
    // Chapa setup fails (bad key, network, rejection), void that order so the
    // customer can retry without losing stock or ending up with a stale record.
    await voidFailedOrder(orderRef && orderRef.id);

    return res.status(502).json({
      message: 'Failed to reach Chapa or set up the payment. Please check your Chapa secret key and your connection, then try again.',
      error: error.message,
    });
  }
});

// Create an order + pending payment and return what's needed to open the
// Chapa.js embedded checkout modal in the browser (no Chapa network call here).
router.post('/chapa/order', requireAuth, async (req, res) => {
  try {
    const { orderRef, txRef, totalAmount } = await createOrderFromCart(req.user.userId, req.body);
    const userResult = await query('SELECT first_name, last_name, email, phone FROM users WHERE id = $1', [req.user.userId]);
    const customer = userResult.rows[0] || {};
    const email = resolveChapaEmail(customer);

    return res.status(201).json({
      message: 'Order created',
      tx_ref: txRef,
      amount: Number(totalAmount),
      order: { ...orderRef, payment_status: 'pending' },
      customer: {
        first_name: (customer.first_name || 'Customer').trim().slice(0, 50),
        last_name: (customer.last_name || '').trim().slice(0, 50),
        email,
        phone_number: customer.phone ? String(customer.phone) : '',
      },
    });
  } catch (error) {
    const status = error.status === 400 ? 400 : 500;
    console.error('[chapa/order] Failed to create order:', error.message);
    return res.status(status).json({ message: error.message || 'Failed to create order' });
  }
});

// Cancel a pending order created for the embedded modal if the customer never
// reached the payment form (e.g. Chapa.js could not load). Restores stock.
router.post('/chapa/cancel', requireAuth, async (req, res) => {
  try {
    const { tx_ref } = req.body || {};
    if (!tx_ref) return res.status(400).json({ message: 'tx_ref is required.' });
    const payResult = await query(
      `SELECT p.order_id, o.user_id FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE p.transaction_id = $1 AND o.user_id = $2`,
      [tx_ref, req.user.userId]
    );
    if (payResult.rowCount === 0) {
      return res.status(404).json({ message: 'Order not found.' });
    }
    await voidFailedOrder(payResult.rows[0].order_id);
    return res.json({ message: 'Order cancelled.' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to cancel order', error: error.message });
  }
});

// Verify a payment against Chapa and update local order/payment status.
router.get('/chapa/verify/:txRef', requireAuth, async (req, res) => {
  try {
    if (!CHAPA_SECRET_KEY) {
      return res.status(503).json({ message: 'Chapa is not configured.' });
    }
    const { txRef } = req.params;

    const payResult = await query(
      `SELECT p.*, o.user_id, o.order_number
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.transaction_id = $1`,
      [txRef]
    );
    if (payResult.rowCount === 0) {
      return res.status(404).json({ message: 'Payment not found.' });
    }
    const paymentRow = payResult.rows[0];
    if (req.user.role !== 'admin' && paymentRow.user_id !== req.user.userId) {
      return res.status(403).json({ message: 'Not allowed to verify this payment.' });
    }

    const result = await chapaRequest(`/v1/transaction/verify/${encodeURIComponent(txRef)}`);
    const gatewayStatus = result.data && result.data.data ? result.data.data.status : '';
    const dbStatus = paymentStatusFromChapa(result.ok ? gatewayStatus : 'failed');

    await query(
      `UPDATE payments SET status = $1, payment_gateway_response = $2, updated_at = NOW() WHERE id = $3`,
      [dbStatus, result.data, paymentRow.id]
    );
    await query(
      `UPDATE orders SET payment_status = $1, updated_at = NOW() WHERE id = $2`,
      [dbStatus, paymentRow.order_id]
    );

    return res.json({
      status: dbStatus,
      order_number: paymentRow.order_number,
      verified: gatewayStatus === 'success',
      gateway_data: result.data,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to verify Chapa payment', error: error.message });
  }
});

// Webhook endpoint Chapa calls after a payment event. Kept unauthenticated by
// design (Chapa POSTs here directly); server-side verification is performed.
router.post('/chapa/webhook', async (req, res) => {
  try {
    if (!CHAPA_SECRET_KEY) {
      return res.status(503).json({ message: 'Chapa is not configured.' });
    }
    const body = req.body || {};
    const data = body.data || body;
    const txRef = data.tx_ref || body.tx_ref || body.tx_reference;
    if (!txRef) {
      return res.status(400).json({ message: 'tx_ref is required.' });
    }

    if (!verifyWebhookSignature(body, txRef)) {
      console.error('[chapa/webhook] Signature verification failed for', txRef);
      return res.status(401).json({ message: 'Invalid webhook signature.' });
    }

    const rawStatus = data.status || data.event || '';
    let dbStatus = paymentStatusFromChapa(rawStatus);

    // Cross-check with Chapa's API as a safety net.
    try {
      const verifyResult = await chapaRequest(`/v1/transaction/verify/${encodeURIComponent(txRef)}`);
      const vStatus = verifyResult.data && verifyResult.data.data ? verifyResult.data.data.status : '';
      if (vStatus) dbStatus = paymentStatusFromChapa(vStatus);
    } catch (_) { /* keep webhook-derived status if verification fails */ }

    await query(
      `UPDATE payments SET status = $1, payment_gateway_response = $2, updated_at = NOW() WHERE transaction_id = $3`,
      [dbStatus, body, txRef]
    );
    await query(
      `UPDATE orders SET payment_status = $1, updated_at = NOW()
       WHERE id = (SELECT order_id FROM payments WHERE transaction_id = $2 LIMIT 1)`,
      [dbStatus, txRef]
    );

    return res.json({ received: true, status: dbStatus });
  } catch (error) {
    return res.status(500).json({ message: 'Webhook handling failed', error: error.message });
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
