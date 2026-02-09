import { Router } from 'express';
import db from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/sessions - list user's sessions
router.get('/', (req, res) => {
  const sessions = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM messages WHERE session_id = s.id AND role != 'system') as message_count
    FROM sessions s
    WHERE s.user_id = ?
    ORDER BY s.updated_at DESC
  `).all(req.user.id);

  res.json(sessions);
});

// POST /api/sessions - create new session
router.post('/', (req, res) => {
  const { title, type } = req.body;

  if (!title || !type) {
    return res.status(400).json({ error: 'כותרת וסוג הם חובה' });
  }

  if (!['homework', 'free'].includes(type)) {
    return res.status(400).json({ error: 'סוג לא תקין' });
  }

  try {
    console.log('Creating session:', { userId: req.user.id, title, type });
    const result = db.prepare(
      'INSERT INTO sessions (user_id, title, type) VALUES (?, ?, ?)'
    ).run(req.user.id, title, type);

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(session);
  } catch (err) {
    console.error('Session creation error:', err.message);
    res.status(500).json({ error: 'שגיאה ביצירת סשן: ' + err.message });
  }
});

// GET /api/sessions/:id - get session with messages
router.get('/:id', (req, res) => {
  const session = db.prepare(
    'SELECT * FROM sessions WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (!session) {
    return res.status(404).json({ error: 'סשן לא נמצא' });
  }

  const messages = db.prepare(
    'SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC'
  ).all(session.id);

  res.json({ ...session, messages });
});

// PATCH /api/sessions/:id - update session (e.g., mark as completed)
router.patch('/:id', (req, res) => {
  const session = db.prepare(
    'SELECT * FROM sessions WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (!session) {
    return res.status(404).json({ error: 'סשן לא נמצא' });
  }

  const { status, title } = req.body;

  if (status && !['active', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'סטטוס לא תקין' });
  }

  const updates = [];
  const values = [];

  if (status) {
    updates.push('status = ?');
    values.push(status);
  }
  if (title) {
    updates.push('title = ?');
    values.push(title);
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.params.id, req.user.id);
    db.prepare(
      `UPDATE sessions SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
    ).run(...values);
  }

  const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  res.json(updated);
});

export default router;
