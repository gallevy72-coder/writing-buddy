import { Router } from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/sessions - list user's sessions
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT s.*,
        (SELECT COUNT(*) FROM messages WHERE session_id = s.id AND role <> 'system') AS message_count
       FROM sessions s
       WHERE s.user_id = $1
       ORDER BY s.updated_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List sessions error:', err.message);
    res.status(500).json({ error: 'שגיאה בטעינת הסשנים' });
  }
});

// POST /api/sessions - create new session
router.post('/', async (req, res) => {
  const { title, type } = req.body;

  if (!title || !type) {
    return res.status(400).json({ error: 'כותרת וסוג הם חובה' });
  }

  if (!['homework', 'free'].includes(type)) {
    return res.status(400).json({ error: 'סוג לא תקין' });
  }

  try {
    console.log('Creating session:', { userId: req.user.id, title, type });
    const result = await query(
      'INSERT INTO sessions (user_id, title, type) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, title, type]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Session creation error:', err.message);
    res.status(500).json({ error: 'שגיאה ביצירת סשן: ' + err.message });
  }
});

// GET /api/sessions/:id - get session with messages
router.get('/:id', async (req, res) => {
  try {
    const sessionResult = await query(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    const session = sessionResult.rows[0];

    if (!session) {
      return res.status(404).json({ error: 'סשן לא נמצא' });
    }

    const messagesResult = await query(
      'SELECT id, role, content, created_at FROM messages WHERE session_id = $1 ORDER BY created_at ASC, id ASC',
      [session.id]
    );

    res.json({ ...session, messages: messagesResult.rows });
  } catch (err) {
    console.error('Get session error:', err.message);
    res.status(500).json({ error: 'שגיאה בטעינת הסשן' });
  }
});

// PATCH /api/sessions/:id - update session (e.g., mark as completed)
router.patch('/:id', async (req, res) => {
  try {
    const sessionResult = await query(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    const session = sessionResult.rows[0];

    if (!session) {
      return res.status(404).json({ error: 'סשן לא נמצא' });
    }

    const { status, title, story_text, reset_character_anchors } = req.body;

    if (status && !['active', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'סטטוס לא תקין' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (status) {
      updates.push(`status = $${idx++}`);
      values.push(status);
    }
    if (title) {
      updates.push(`title = $${idx++}`);
      values.push(title);
    }
    if (story_text !== undefined) {
      updates.push(`story_text = $${idx++}`);
      values.push(story_text);
    }
    if (reset_character_anchors) {
      // איפוס תיאורי הדמויות — יחולצו מחדש באיור הבא
      updates.push(`character_anchors = $${idx++}`);
      values.push(null);
    }

    if (updates.length > 0) {
      updates.push(`updated_at = NOW()`);
      values.push(req.params.id, req.user.id);
      await query(
        `UPDATE sessions SET ${updates.join(', ')} WHERE id = $${idx++} AND user_id = $${idx++}`,
        values
      );
    }

    const updated = await query('SELECT * FROM sessions WHERE id = $1', [req.params.id]);
    res.json(updated.rows[0]);
  } catch (err) {
    console.error('Update session error:', err.message);
    res.status(500).json({ error: 'שגיאה בעדכון הסשן' });
  }
});

export default router;
