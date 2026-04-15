import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, password, displayName } = req.body;

  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'כל השדות הם חובה' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'שם המשתמש חייב להכיל לפחות 3 תווים' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 4 תווים' });
  }

  try {
    const existing = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'שם המשתמש כבר תפוס' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(
      'INSERT INTO users (username, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id',
      [username, passwordHash, displayName]
    );
    const userId = result.rows[0].id;

    const token = jwt.sign(
      { id: userId, username, displayName },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ token, user: { id: userId, username, displayName } });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'שגיאה ביצירת המשתמש' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'שם משתמש וסיסמה הם חובה' });
  }

  try {
    const result = await query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, displayName: user.display_name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: user.id, username: user.username, displayName: user.display_name } });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'שגיאה בהתחברות' });
  }
});

export default router;
