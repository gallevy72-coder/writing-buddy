import { Router } from 'express';
import db from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { SYSTEM_PROMPT } from '../systemPrompt.js';

const router = Router();
router.use(authenticate);

async function callAI(messages, maxTokens = 1000) {
  const GROQ_KEY = process.env.GROQ_API_KEY;
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_KEY}`,
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

// POST /api/chat/illustrate - generate illustration for the story
router.post('/illustrate', async (req, res) => {
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

  try {
    // Ask AI to create an image prompt based on the story
    // Extract story details for image prompt
    const storyText = history
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(' ');

    const promptMessages = [
      {
        role: 'system',
        content: 'You are a translator. Translate the key story elements from Hebrew to a short English image prompt. Rules: 1) Write ONLY in English. 2) Max 8 words. 3) No explanations, no Hebrew, just the English prompt. 4) Focus on the main character and location.',
      },
      {
        role: 'user',
        content: `Story text (Hebrew): "${storyText.slice(0, 300)}"\n\nWrite the English image prompt (8 words max, English only):`,
      },
    ];

    const imagePrompt = await callAI(promptMessages, 20);
    const cleanPrompt = imagePrompt.trim().replace(/["""'']/g, '').split('\n')[0];
    console.log('Image prompt generated:', cleanPrompt);

    // Generate image using Gemini
    let assistantMessage;
    try {
      const GEMINI_KEY = process.env.GEMINI_API_KEY;
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: `children's book illustration style: ${cleanPrompt}` }],
            parameters: { sampleCount: 1 },
          }),
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        console.error('Imagen error:', geminiRes.status, errText);
        throw new Error('Imagen failed');
      }

      const geminiData = await geminiRes.json();
      const prediction = geminiData.predictions?.[0];

      console.log('Imagen prediction keys:', prediction ? Object.keys(prediction) : 'no prediction');
      if (prediction?.bytesBase64Encoded) {
        const mimeType = prediction.mimeType || 'image/png';
        const dataUrl = `data:${mimeType};base64,${prediction.bytesBase64Encoded}`;
        assistantMessage = `הנה ציור של הסיפור שלך! 🎨\n![איור הסיפור](${dataUrl})`;
      } else {
        throw new Error('No image in response');
      }
    } catch (imgErr) {
      console.error('Image generation failed, using text fallback:', imgErr.message);
      // Fallback: ask AI to describe the scene
      const descMessages = [
        { role: 'system', content: 'תאר בעברית, במשפט אחד קצר וציורי, את הסצנה הראשית של הסיפור כאילו אתה מתאר ציור.' },
        ...history.map(m => ({ role: m.role, content: m.content })),
      ];
      const description = await callAI(descMessages, 100);
      assistantMessage = `🎨 ציור הסיפור:\n${description}`;
    }

    db.prepare(
      'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'
    ).run(sessionId, 'user', 'צייר לי את הסיפור!');

    db.prepare(
      'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'
    ).run(sessionId, 'assistant', assistantMessage);

    db.prepare(
      'UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(sessionId);

    res.json({ message: assistantMessage });
  } catch (err) {
    console.error('Illustrate error:', err.message);
    res.status(500).json({ error: 'שגיאה ביצירת האיור. נסה שוב.' });
  }
});

export default router;
