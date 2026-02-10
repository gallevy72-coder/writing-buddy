import jwt from 'jsonwebtoken';
import db from '../db.js';

export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'נדרשת התחברות' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verify user still exists in DB (DB resets on redeploy)
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'משתמש לא נמצא, יש להירשם מחדש' });
    }

    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'טוקן לא תקין' });
  }
}
