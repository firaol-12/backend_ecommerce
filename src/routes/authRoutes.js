const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const router = express.Router();

const { query } = require('../config/db');
const { sanitizeUser } = require('../utils/helpers');
const { requireAuth } = require('../middleware/auth');

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL
);

function generateToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET || 'change-me',
    { expiresIn: '7d' }
  );
}

router.post('/register', async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      password,
      phone,
      avatar,
    } = req.body;

    if (!first_name || !last_name || !email || !password) {
      return res.status(400).json({ message: 'first_name, last_name, email and password are required.' });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ message: 'User already exists with this email.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (first_name, last_name, email, password, phone, avatar)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, first_name, last_name, email, phone, avatar, role, is_active, created_at, updated_at`,
      [first_name.trim(), last_name.trim(), email.trim().toLowerCase(), hashedPassword, phone || null, avatar || null]
    );

    const user = result.rows[0];
    const token = generateToken({ ...user, role: 'customer' });

    return res.status(201).json({
      message: 'User registered successfully',
      user: sanitizeUser({ ...user, role: 'customer' }),
      token,
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ message: 'Failed to register user', error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const result = await query(
      'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
      [String(email).trim().toLowerCase()]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    // Google-only accounts have no password set.
    if (!user.password) {
      return res.status(401).json({ message: 'This account uses Google sign-in. Please continue with Google.' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = generateToken(user);

    return res.json({
      message: 'Login successful',
      user: sanitizeUser(user),
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Failed to login', error: error.message });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, first_name, last_name, email, phone, avatar, role, is_active, created_at, updated_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get me error:', error);
    return res.status(500).json({ message: 'Unable to fetch user profile', error: error.message });
  }
});

// Google OAuth routes
router.get('/google', (req, res) => {
  // 'openid' is required so Google returns an id_token, which the
  // callback route verifies. The userinfo scopes provide profile data.
  const scopes = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ];

  const authUrl = googleClient.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });

  res.redirect(authUrl);
});

router.get('/google/callback', async (req, res) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).json({ message: 'Authorization code is required.' });
    }

    const { tokens } = await googleClient.getToken(code);
    googleClient.setCredentials(tokens);

    let payload;

    if (tokens.id_token) {
      const ticket = await googleClient.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } else {
      // Fallback: fetch the profile directly with the access token.
      payload = await googleClient.getUserInfo(tokens.access_token);
    }
    const googleId = payload.sub;
    const email = payload.email;
    const firstName = payload.given_name || '';
    const lastName = payload.family_name || '';
    const avatar = payload.picture || null;

    if (!email) {
      return res.status(400).json({ message: 'Email not provided by Google.' });
    }

    // Check if user exists by google_id
    let result = await query(
      'SELECT * FROM users WHERE google_id = $1',
      [googleId]
    );

    let user;

    if (result.rowCount > 0) {
      // User exists with this Google ID
      user = result.rows[0];
    } else {
      // Check if user exists with this email
      result = await query(
        'SELECT * FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (result.rowCount > 0) {
        // User exists with email, link Google account
        user = result.rows[0];
        await query(
          'UPDATE users SET google_id = $1, avatar = COALESCE(avatar, $2) WHERE id = $3',
          [googleId, avatar, user.id]
        );
      } else {
        // Create new user
        const insertResult = await query(
          `INSERT INTO users (first_name, last_name, email, google_id, avatar, role, is_active)
           VALUES ($1, $2, $3, $4, $5, 'customer', true)
           RETURNING id, first_name, last_name, email, phone, avatar, role, is_active, created_at, updated_at`,
          [firstName, lastName, email.toLowerCase(), googleId, avatar]
        );
        user = insertResult.rows[0];
      }
    }

    const token = generateToken(user);

    // Redirect to frontend with token
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  } catch (error) {
    console.error('Google OAuth error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    // Surface the real reason to the frontend so failures are diagnosable
    // (e.g. invalid_client, invalid_grant, missing DB column, etc.).
    const details = encodeURIComponent(String(error?.message || error).slice(0, 200));
    res.redirect(`${frontendUrl}/login?error=google_auth_failed&details=${details}`);
  }
});

module.exports = router;
