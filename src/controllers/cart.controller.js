const pool = require('../config/db');

// Helper: get or create a cart for the logged-in user
async function getOrCreateCart(userId) {
  const existing = await pool.query('SELECT * FROM carts WHERE user_id = $1', [userId]);
  if (existing.rows.length > 0) {
    return existing.rows[0];
  }
  const created = await pool.query(
    'INSERT INTO carts (user_id) VALUES ($1) RETURNING *',
    [userId]
  );
  return created.rows[0];
}

// GET /api/cart
async function getCart(req, res) {
  try {
    const cart = await getOrCreateCart(req.user.userId);

    const items = await pool.query(
      `SELECT ci.id, ci.quantity, ci.product_variant_id,
              pv.sku, pv.size, pv.color, pv.price, pv.stock_quantity,
              p.name AS product_name, p.slug AS product_slug
       FROM cart_items ci
       JOIN product_variants pv ON ci.product_variant_id = pv.id
       JOIN products p ON pv.product_id = p.id
       WHERE ci.cart_id = $1`,
      [cart.id]
    );

    res.json({ cartId: cart.id, items: items.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// POST /api/cart/add
async function addToCart(req, res) {
  const { productVariantId, quantity } = req.body;

  if (!productVariantId || !quantity || quantity < 1) {
    return res.status(400).json({ error: 'productVariantId and a valid quantity are required' });
  }

  try {
    const cart = await getOrCreateCart(req.user.userId);

    // Check stock
    const variant = await pool.query(
      'SELECT stock_quantity FROM product_variants WHERE id = $1',
      [productVariantId]
    );

    if (variant.rows.length === 0) {
      return res.status(404).json({ error: 'Product variant not found' });
    }

    if (variant.rows[0].stock_quantity < quantity) {
      return res.status(400).json({ error: 'Not enough stock available' });
    }

    // If item already in cart, increase quantity instead of duplicating
    const existingItem = await pool.query(
      'SELECT * FROM cart_items WHERE cart_id = $1 AND product_variant_id = $2',
      [cart.id, productVariantId]
    );

    let result;
    if (existingItem.rows.length > 0) {
      result = await pool.query(
        `UPDATE cart_items SET quantity = quantity + $1 
         WHERE id = $2 RETURNING *`,
        [quantity, existingItem.rows[0].id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO cart_items (cart_id, product_variant_id, quantity)
         VALUES ($1, $2, $3) RETURNING *`,
        [cart.id, productVariantId, quantity]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// PUT /api/cart/:itemId
async function updateCartItem(req, res) {
  const { itemId } = req.params;
  const { quantity } = req.body;

  if (!quantity || quantity < 1) {
    return res.status(400).json({ error: 'A valid quantity is required' });
  }

  try {
    const cart = await getOrCreateCart(req.user.userId);

    const result = await pool.query(
      `UPDATE cart_items SET quantity = $1 
       WHERE id = $2 AND cart_id = $3 
       RETURNING *`,
      [quantity, itemId, cart.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// DELETE /api/cart/:itemId
async function removeFromCart(req, res) {
  const { itemId } = req.params;

  try {
    const cart = await getOrCreateCart(req.user.userId);

    const result = await pool.query(
      'DELETE FROM cart_items WHERE id = $1 AND cart_id = $2 RETURNING id',
      [itemId, cart.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    res.json({ message: 'Item removed from cart' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

module.exports = { getCart, addToCart, updateCartItem, removeFromCart };