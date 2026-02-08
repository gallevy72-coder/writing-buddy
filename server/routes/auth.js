import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import db from '../db.js';

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

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'שם המשתמש כבר תפוס' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)'
    ).run(username, passwordHash, displayName);

    const token = jwt.sign(
      { id: result.lastInsertRowid, username, displayName },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ token, user: { id: result.lastInsertRowid, username, displayName } });
  } catch (err) {
    res.status(500).json({ error: 'שגיאה ביצירת המשתמש' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'שם משתמש וסיסמה הם חובה' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
  }

  try {
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
    res.status(500).json({ error: 'שגיאה בהתחברות' });
  }
});

export default router;
