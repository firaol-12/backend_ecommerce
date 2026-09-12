const express = require('express');
const router = express.Router();

const { query, pool } = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { slugify, buildPagination } = require('../utils/helpers');

// Base64 data URLs for product images can be large; reject anything absurd.
const MAX_IMAGE_LENGTH = 3000000; // characters (~2 MB of decoded image data)

router.get('/', async (req, res) => {
  try {
    const { categoryId, search, minPrice, maxPrice, sort = 'newest', page = 1, limit = 12 } = req.query;
    const { offset, limit: pageLimit } = buildPagination(page, limit);

    let sql = `
      SELECT p.*, c.name AS category_name,
             COALESCE((SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id AND pi.is_main_image = TRUE LIMIT 1), '') AS main_image,
             COALESCE((SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id AND pi.is_main_image = TRUE LIMIT 1), '') AS image_url
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = TRUE
    `;
    const params = [];
    let paramIndex = 1;

    if (categoryId) {
      sql += ` AND p.category_id = $${paramIndex}`;
      params.push(categoryId);
      paramIndex += 1;
    }

    if (search) {
      sql += ` AND (p.name ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex += 1;
    }

    if (minPrice) {
      sql += ` AND p.price >= $${paramIndex}`;
      params.push(Number(minPrice));
      paramIndex += 1;
    }

    if (maxPrice) {
      sql += ` AND p.price <= $${paramIndex}`;
      params.push(Number(maxPrice));
      paramIndex += 1;
    }

    const sortMap = {
      newest: 'p.created_at DESC',
      price_asc: 'p.price ASC',
      price_desc: 'p.price DESC',
      rating: 'p.rating DESC',
      popular: 'p.view_count DESC',
    };

    sql += ` ORDER BY ${sortMap[sort] || sortMap.newest}`;
    sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(pageLimit, offset);

    const result = await query(sql, params);

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM products p WHERE p.is_active = TRUE ${categoryId ? 'AND p.category_id = $1' : ''}`,
      categoryId ? [categoryId] : []
    );

    return res.json({
      products: result.rows,
      pagination: {
        page: Number(page),
        limit: pageLimit,
        total: Number(countResult.rows[0].total),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch products', error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const productResult = await query(
      `SELECT p.*, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = $1`,
      [req.params.id]
    );

    if (productResult.rowCount === 0) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    const imagesResult = await query(
      `SELECT * FROM product_images WHERE product_id = $1 ORDER BY display_order ASC, created_at ASC`,
      [req.params.id]
    );

    const product = productResult.rows[0];
    product.images = imagesResult.rows;

    return res.json({ product });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch product', error: error.message });
  }
});

router.get('/slug/:slug', async (req, res) => {
  try {
    const productResult = await query('SELECT * FROM products WHERE slug = $1', [req.params.slug]);
    if (productResult.rowCount === 0) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    const product = productResult.rows[0];
    const imagesResult = await query(
      `SELECT * FROM product_images WHERE product_id = $1 ORDER BY display_order ASC, created_at ASC`,
      [product.id]
    );

    product.images = imagesResult.rows;

    return res.json({ product });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch product by slug', error: error.message });
  }
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const {
      name,
      description,
      price,
      cost_price,
      discount = 0,
      category_id,
      stock = 0,
      sku,
      is_active = true,
    } = req.body;

    if (!name || !description || !price || !category_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'name, description, price, and category_id are required.' });
    }

    const image_url = req.body.image_url || req.body.main_image;
    if (image_url && image_url.length > MAX_IMAGE_LENGTH) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Image data is too large. Please upload a smaller image.' });
    }

    const slug = slugify(name);
    const result = await client.query(
      `INSERT INTO products (
        name, slug, description, price, cost_price, discount, category_id, stock, sku, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [name, slug, description, Number(price), cost_price !== undefined ? Number(cost_price) : null, Number(discount), Number(category_id), Number(stock), sku || null, is_active]
    );

    const product = result.rows[0];

    // Save the main image if one was provided
    if (image_url) {
      await client.query(
        `INSERT INTO product_images (product_id, image_url, alt_text, display_order, is_main_image)
         VALUES ($1, $2, $3, 0, TRUE)
         RETURNING *`,
        [product.id, image_url, name || null]
      );
    }

    await client.query('COMMIT');
    return res.status(201).json({ message: 'Product created successfully', product });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connection may already be closed */ }
    }
    return res.status(500).json({ message: 'Failed to create product', error: error.message });
  } finally {
    if (client) client.release();
  }
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const { name, description, price, cost_price, discount, category_id, stock, sku, is_active } = req.body;
    const slug = name ? slugify(name) : null;

    const result = await client.query(
      `UPDATE products
       SET name = COALESCE($1, name),
           slug = COALESCE($2, slug),
           description = COALESCE($3, description),
           price = COALESCE($4, price),
           cost_price = COALESCE($5, cost_price),
           discount = COALESCE($6, discount),
           category_id = COALESCE($7, category_id),
           stock = COALESCE($8, stock),
           sku = COALESCE($9, sku),
           is_active = COALESCE($10, is_active),
           updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [name || null, slug, description !== undefined ? description : null, price !== undefined ? Number(price) : null, cost_price !== undefined ? Number(cost_price) : null, discount !== undefined ? Number(discount) : null, category_id !== undefined ? Number(category_id) : null, stock !== undefined ? Number(stock) : null, sku !== undefined ? sku : null, is_active !== undefined ? is_active : null, req.params.id]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Product not found.' });
    }

    // Update the main image if a new one was provided
    const image_url = req.body.image_url || req.body.main_image;
    if (image_url && image_url.length > MAX_IMAGE_LENGTH) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Image data is too large. Please upload a smaller image.' });
    }
    if (image_url) {
      await client.query(
        `UPDATE product_images
         SET is_main_image = FALSE
         WHERE product_id = $1 AND is_main_image = TRUE`,
        [req.params.id]
      );

      const existingMain = await client.query(
        `SELECT id FROM product_images WHERE product_id = $1 AND image_url = $2`,
        [req.params.id, image_url]
      );

      if (existingMain.rowCount > 0) {
        // NOTE: product_images has no updated_at column, so only flip the flag.
        await client.query(
          `UPDATE product_images
           SET is_main_image = TRUE
           WHERE id = $1`,
          [existingMain.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO product_images (product_id, image_url, alt_text, display_order, is_main_image)
           VALUES ($1, $2, $3, 0, TRUE)
           RETURNING *`,
          [req.params.id, image_url, name || null]
        );
      }
    }

    await client.query('COMMIT');
    return res.json({ message: 'Product updated successfully', product: result.rows[0] });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connection may already be closed */ }
    }
    return res.status(500).json({ message: 'Failed to update product', error: error.message });
  } finally {
    if (client) client.release();
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await query('DELETE FROM products WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Product not found.' });
    }
    return res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete product', error: error.message });
  }
});

router.post('/:id/images', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { image_url, alt_text, display_order = 0, is_main_image = false } = req.body;
    if (!image_url) {
      return res.status(400).json({ message: 'image_url is required.' });
    }
    if (image_url.length > MAX_IMAGE_LENGTH) {
      return res.status(400).json({ message: 'Image data is too large. Please upload a smaller image.' });
    }

    const result = await query(
      `INSERT INTO product_images (product_id, image_url, alt_text, display_order, is_main_image)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.params.id, image_url, alt_text || null, Number(display_order), Boolean(is_main_image)]
    );

    return res.status(201).json({ message: 'Product image added', image: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to add product image', error: error.message });
  }
});

module.exports = router;
