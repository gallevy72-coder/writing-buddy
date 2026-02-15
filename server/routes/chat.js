import { Router } from 'express';
import db from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { SYSTEM_PROMPT } from '../systemPrompt.js';

const router = Router();
router.use(authenticate);

async function callGemini(messages, maxTokens = 1000) {
  const apiKey = process.env.GEMINI_API_KEY;

  // Separate system message from conversation
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  // Convert OpenAI format to Gemini format
  const contents = chatMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: maxTokens,
    },
  };

  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    console.error('Gemini HTTP error:', response.status, err);
    throw new Error(`Gemini error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
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
    const assistantMessage = await callGemini(openaiMessages);

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
    const feedbackMessage = await callGemini(openaiMessages, 1500);

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
