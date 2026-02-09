import { Router } from 'express';
import OpenAI from 'openai';
import db from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { SYSTEM_PROMPT } from '../systemPrompt.js';

const router = Router();
router.use(authenticate);

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  console.log('OpenAI key loaded:', key ? `${key.substring(0, 8)}...` : 'MISSING');
  return new OpenAI({ apiKey: key });
}

// POST /api/chat - send a message and get AI response
router.post('/', async (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessionId || !message) {
    return res.status(400).json({ error: 'נדרשים מזהה סשן והודעה' });
  }

  // Verify session belongs to user
  const session = db.prepare(
    'SELECT * FROM sessions WHERE id = ? AND user_id = ?'
  ).get(sessionId, req.user.id);

  if (!session) {
    return res.status(404).json({ error: 'סשן לא נמצא' });
  }

  if (session.status === 'completed') {
    return res.status(400).json({ error: 'הסשן כבר הסתיים' });
  }

  // Save user message
  db.prepare(
    'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'
  ).run(sessionId, 'user', message);

  // Get conversation history
  const history = db.prepare(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId);

  // Build messages for OpenAI
  const openaiMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(m => ({ role: m.role, content: m.content })),
  ];

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: openaiMessages,
      temperature: 0.7,
      max_tokens: 1000,
    });

    const assistantMessage = completion.choices[0].message.content;

    // Save assistant message
    db.prepare(
      'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'
    ).run(sessionId, 'assistant', assistantMessage);

    // Update session timestamp
    db.prepare(
      'UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(sessionId);

    res.json({ message: assistantMessage });
  } catch (err) {
    console.error('OpenAI API error:', err.message, err.code, err.status, err.type);
    res.status(500).json({ error: 'שגיאה בתקשורת עם ה-AI. נסה שוב.' });
  }
});

// POST /api/chat/finish - request final feedback
router.post('/finish', async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'נדרש מזהה סשן' });
  }

  const session = db.prepare(
    'SELECT * FROM sessions WHERE id = ? AND user_id = ?'
  ).get(sessionId, req.user.id);

  if (!session) {
    return res.status(404).json({ error: 'סשן לא נמצא' });
  }

  // Get conversation history
  const history = db.prepare(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId);

  const openaiMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(m => ({ role: m.role, content: m.content })),
    {
      role: 'user',
      content: 'סיימתי לכתוב! אנא תן לי משוב מסכם לפי מחוון ראמ"ה (תוכן, לכידות, לשון, מוסכמות). ציין שני כוכבים (נקודות חוזקה) ומשאלה אחת (נקודה לשיפור).',
    },
  ];

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: openaiMessages,
      temperature: 0.7,
      max_tokens: 1500,
    });

    const feedbackMessage = completion.choices[0].message.content;

    // Save the finish request and response
    db.prepare(
      'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'
    ).run(sessionId, 'user', 'סיימתי לכתוב! אנא תן לי משוב מסכם.');

    db.prepare(
      'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'
    ).run(sessionId, 'assistant', feedbackMessage);

    // Mark session as completed
    db.prepare(
      'UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run('completed', sessionId);

    res.json({ message: feedbackMessage });
  } catch (err) {
    console.error('OpenAI API error:', err.message, err.code, err.status, err.type);
    res.status(500).json({ error: 'שגיאה בתקשורת עם ה-AI. נסה שוב.' });
  }
});

export default router;
