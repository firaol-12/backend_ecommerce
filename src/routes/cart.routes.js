const express = require('express');
const router = express.Router();
const { getCart, addToCart, removeFromCart } = require('../controllers/cart.controller');
const authMiddleware = require('../middleware/auth.middleware');

router.get('/', authMiddleware, getCart);
router.post('/add', authMiddleware, addToCart);
router.delete('/:itemId', authMiddleware, removeFromCart);

module.exports = router;