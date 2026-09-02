const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
 
// POST /api/auth/signup
async function signup(req, res) {
  const { name, email, password } = req.body;
 
  // 1. Basic validation
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
 
  try {
    // 2. Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
 
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Email is already registered' });
    }
 
    // 3. Hash the password (never store plain text passwords!)
    const passwordHash = await bcrypt.hash(password, 10);
 
    // 4. Insert new user into the database
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash) 
       VALUES ($1, $2, $3) 
       RETURNING id, name, email, role, created_at`,
      [name, email, passwordHash]
    );
 
    const newUser = result.rows[0];
 
    // 5. Create a JWT token so the user is logged in right after signup
    const token = jwt.sign(
      { userId: newUser.id, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
 
    res.status(201).json({ user: newUser, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong during signup' });
  }
}
 
// POST /api/auth/login
async function login(req, res) {
  const { email, password } = req.body;
 
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
 
  try {
    // 1. Find the user by email
    const result = await pool.query(
      'SELECT id, name, email, password_hash, role FROM users WHERE email = $1',
      [email]
    );
 
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
 
    const user = result.rows[0];
 
    // 2. Compare submitted password with the hashed password in the database
    const isPasswordCorrect = await bcrypt.compare(password, user.password_hash);
 
    if (!isPasswordCorrect) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
 
    // 3. Create a JWT token
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
 
    // 4. Don't send password_hash back to the client
    delete user.password_hash;
 
    res.json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong during login' });
  }
}
 
module.exports = { signup, login };