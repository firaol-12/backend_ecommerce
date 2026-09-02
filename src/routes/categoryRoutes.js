const express = require('express');
const router = express.Router();

const { query } = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { slugify } = require('../utils/helpers');

router.get('/', async (req, res) => {
  try {
    const categories = await query(
      `SELECT * FROM categories WHERE is_active = TRUE ORDER BY created_at DESC`
    );
    return res.json({ categories: categories.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch categories', error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM categories WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Category not found.' });
    }
    return res.json({ category: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch category', error: error.message });
  }
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, description, image } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Category name is required.' });
    }

    const generatedSlug = slugify(name);
    const result = await query(
      `INSERT INTO categories (name, slug, description, image)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, generatedSlug, description || null, image || null]
    );

    return res.status(201).json({ message: 'Category created successfully', category: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create category', error: error.message });
  }
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, description, image, is_active } = req.body;
    const newSlug = name ? slugify(name) : null;

    const result = await query(
      `UPDATE categories
       SET name = COALESCE($1, name),
           slug = COALESCE($2, slug),
           description = COALESCE($3, description),
           image = COALESCE($4, image),
           is_active = COALESCE($5, is_active),
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [name || null, newSlug, description !== undefined ? description : null, image !== undefined ? image : null, is_active !== undefined ? is_active : null, req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Category not found.' });
    }

    return res.json({ message: 'Category updated successfully', category: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update category', error: error.message });
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await query('DELETE FROM categories WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Category not found.' });
    }
    return res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete category', error: error.message });
  }
});

module.exports = router;
