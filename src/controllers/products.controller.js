const pool = require('../config/db');

// GET /api/products
async function getAllProducts(req, res) {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.slug, p.base_price, p.brand, p.is_active,
              c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.is_active = true
       ORDER BY p.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// GET /api/products/categories
async function getAllCategories(req, res) {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// GET /api/products/:slug
async function getProductBySlug(req, res) {
  const { slug } = req.params;

  try {
    // 1. Get the product itself
    const productResult = await pool.query(
      `SELECT p.*, c.name AS category_name 
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.slug = $1`,
      [slug]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = productResult.rows[0];

    // 2. Get its variants (sizes/colors/stock)
    const variantsResult = await pool.query(
      'SELECT * FROM product_variants WHERE product_id = $1',
      [product.id]
    );

    // 3. Get its images
    const imagesResult = await pool.query(
      'SELECT * FROM product_images WHERE product_id = $1 ORDER BY position',
      [product.id]
    );

    res.json({
      ...product,
      variants: variantsResult.rows,
      images: imagesResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}

module.exports = { getAllProducts, getProductBySlug, getAllCategories };