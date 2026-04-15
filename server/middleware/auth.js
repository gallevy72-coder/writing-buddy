import jwt from 'jsonwebtoken';
import { query } from '../db.js';

export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'נדרשת התחברות' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verify user still exists in DB
    const result = await query('SELECT id FROM users WHERE id = $1', [decoded.id]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'משתמש לא נמצא, יש להירשם מחדש' });
    }

    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'טוקן לא תקין' });
  }
}
