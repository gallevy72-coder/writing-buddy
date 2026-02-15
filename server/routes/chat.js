import { Router } from 'express';
import db from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { SYSTEM_PROMPT } from '../systemPrompt.js';

const router = Router();
router.use(authenticate);

async function callAI(messages, maxTokens = 1000) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AI_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.7,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Groq HTTP error:', response.status, err);
    throw new Error(`Groq error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// POST /api/chat - send a message and get AI response
router.post('/', async (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessionId || !message) {
    return res.status(400).json({ error: 'נדרשים מזהה סשן והודעה' });
  }

  const session = db.prepare(
    'SELECT * FROM sessions WHERE id = ? AND user_id = ?'
  ).get(sessionId, req.user.id);

  if (!session) {
    return res.status(404).json({ error: 'סשן לא נמצא' });
  }

  if (session.status === 'completed') {
    return res.status(400).json({ error: 'הסשן כבר הסתיים' });
  }

  db.prepare(
    'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'
  ).run(sessionId, 'user', message);

  const history = db.prepare(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId);

  const openaiMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(m => ({ role: m.role, content: m.content })),
  ];

  try {
    const assistantMessage = await callAI(openaiMessages);

    db.prepare(
      'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'
    ).run(sessionId, 'assistant', assistantMessage);

    db.prepare(
      'UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(sessionId);

    res.json({ message: assistantMessage });
  } catch (err) {
    console.error('Chat error:', err.message);
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
    const feedbackMessage = await callAI(openaiMessages, 1500);

    db.prepare(
      'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'
    ).run(sessionId, 'user', 'סיימתי לכתוב! אנא תן לי משוב מסכם.');

    db.prepare(
      'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'
    ).run(sessionId, 'assistant', feedbackMessage);

    db.prepare(
      'UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run('completed', sessionId);

    res.json({ message: feedbackMessage });
  } catch (err) {
    console.error('Finish error:', err.message);
    res.status(500).json({ error: 'שגיאה בתקשורת עם ה-AI. נסה שוב.' });
  }
});

export default router;
