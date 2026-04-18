import { Router } from 'express';
import { query } from '../db.js';
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

// קיצור היסטוריית שיחה לפני שליחה ל-Groq
// בעיה: שיחות ארוכות חורגות מ-12,000 TPM של הTier החינמי
// פתרון: שמור 4 הודעות ראשונות (תכנון הסיפור) + 20 אחרונות, ומחק data: URLs ענקיות
function trimHistory(history, maxMessages = 20, keepFirst = 4) {
  // מחק data: URLs מהודעות עם תמונות — הן ענקיות ולא נחוצות לצ'אט
  const clean = history.map(m => ({
    ...m,
    content: m.content.replace(/!\[([^\]]*)\]\(data:[^)]{50,}\)/g, '[🎨 איור]'),
  }));

  if (clean.length <= maxMessages + keepFirst) return clean;

  const first = clean.slice(0, keepFirst);        // שמור תמיד את שלב התכנון
  const recent = clean.slice(-(maxMessages));      // ו-20 ההודעות האחרונות
  return [...first, ...recent];
}

router.post('/', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: 'נדרשים מזהה סשן והודעה' });
  try {
    const sessionRes = await query('SELECT * FROM sessions WHERE id = $1 AND user_id = $2', [sessionId, req.user.id]);
    const session = sessionRes.rows[0];
    if (!session) return res.status(404).json({ error: 'סשן לא נמצא' });
    if (session.status === 'completed') return res.status(400).json({ error: 'הסשן כבר הסתיים' });
    await query('INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)', [sessionId, 'user', message]);
    const historyRes = await query('SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at ASC, id ASC', [sessionId]);
    const history = historyRes.rows;
    const trimmed = trimHistory(history);
    const openaiMessages = [{ role: 'system', content: SYSTEM_PROMPT }, ...trimmed.map(m => ({ role: m.role, content: m.content }))];
    const assistantMessage = await callAI(openaiMessages);
    await query('INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)', [sessionId, 'assistant', assistantMessage]);
    await query('UPDATE sessions SET updated_at = NOW() WHERE id = $1', [sessionId]);
    res.json({ message: assistantMessage });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'שגיאה בתקשורת עם ה-AI. נסה שוב.' });
  }
});

router.post('/finish', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'נדרש מזהה סשן' });
  const sessionRes = await query('SELECT * FROM sessions WHERE id = $1 AND user_id = $2', [sessionId, req.user.id]);
  const session = sessionRes.rows[0];
  if (!session) return res.status(404).json({ error: 'סשן לא נמצא' });
  const historyRes = await query('SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at ASC, id ASC', [sessionId]);
  const history = historyRes.rows;

  // פרומפט משוב לפי שיטת "שני כוכבים ומשאלה" בהתאם למחוון ראמ"ה לכיתות ג'-ו'
  const feedbackPrompt = `סיימת לכתוב! תפקידך לתת משוב עידודי לילד בכיתות ג'-ו' בשיטת "שני כוכבים ומשאלה".

כתוב בדיוק בפורמט הבא, בשפה חמה וידידותית לילד:

⭐ כוכב ראשון: [שבח ספציפי על דבר אחד שבלט – יכול להיות על תוכן הסיפור, על דמויות מעניינות, על תיאורים, או על רעיון מקורי]

⭐ כוכב שני: [שבח ספציפי על דבר שני שבלט – יכול להיות על בניית הסיפור, על לשון, על רגשות שהוצגו, או על פרטים מוצלחים]

🌱 המשאלה שלי: [דבר אחד שהייתי שמח לראות יותר בסיפור הבא – בניסוח חיובי ומעודד, לא ביקורתי]

חשוב: כתוב בגוף שני ישיר לילד, שלוש שורות בלבד, ללא כותרות נוספות, ללא הסברים מחוץ לפורמט.`;

  const trimmedForFinish = trimHistory(history, 30, 4);
  const openaiMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...trimmedForFinish.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: feedbackPrompt }
  ];

  try {
    const feedbackMessage = await callAI(openaiMessages, 600);
    await query('INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)', [sessionId, 'user', 'סיימתי לכתוב! אנא תן לי משוב מסכם.']);
    await query('INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)', [sessionId, 'assistant', feedbackMessage]);
    await query('UPDATE sessions SET status = $1, updated_at = NOW() WHERE id = $2', ['completed', sessionId]);
    res.json({ message: feedbackMessage });
  } catch (err) {
    console.error('Finish error:', err.message);
    res.status(500).json({ error: 'שגיאה בתקשורת עם ה-AI. נסה שוב.' });
  }
});

router.post('/illustrate', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'נדרש מזהה סשן' });
  const sessionRes = await query('SELECT * FROM sessions WHERE id = $1 AND user_id = $2', [sessionId, req.user.id]);
  const session = sessionRes.rows[0];
  if (!session) return res.status(404).json({ error: 'סשן לא נמצא' });
  const historyRes = await query('SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at ASC, id ASC', [sessionId]);
  const history = historyRes.rows;
  try {
    // כל הטקסט של המשתמש – כולל שלב המסגרת (לחילוץ תיאור הדמויות)
    const allUserContent = history.filter(m => m.role === 'user').map(m => m.content).join('\n');
    // 4 הודעות אחרונות של המשתמש – לתיאור הסצנה הנוכחית
    const recentScene = history.filter(m => m.role === 'user').slice(-4).map(m => m.content).join(' ');

    // ─── שלב 1: חילוץ תיאור דמות קבוע + סצנה נוכחית בשני שורות נפרדות ──────────
    // זה הסוד לעקביות: SDXL מקבל תיאור דמות זהה בכל ציור, רק הסצנה משתנה.
    const promptMessages = [
      {
        role: 'system',
        content: `You extract illustration data from a Hebrew children's story. Output EXACTLY 2 lines, English only, no Hebrew, no quotes, no explanations:
LINE 1 – CHARACTER (fixed physical traits that never change): [age]-year-old [boy/girl], [hair color] [hair length/style] hair, [eye color] eyes, [skin tone] skin, wearing [specific clothing with colors]
LINE 2 – SCENE (current action and setting, no appearance): [exactly what the character is doing right now], [specific location/setting], [key objects in the scene]

Example output:
8-year-old girl, short blonde curly hair, blue eyes, fair skin, wearing pink dress and white sneakers
running through a sunny park, searching behind a big oak tree, colorful flowers all around`
      },
      {
        role: 'user',
        content: `Full story context (Hebrew – use for character appearance):\n"${allUserContent.slice(0, 800)}"\n\nCurrent scene (Hebrew – use for LINE 2 only):\n"${recentScene.slice(0, 400)}"\n\nOutput exactly 2 lines:`
      }
    ];

    const rawPrompt = await callAI(promptMessages, 100);
    const lines = rawPrompt.trim().split('\n')
      .map(l => l.replace(/^(LINE\s*\d\s*[-–:]|CHARACTER\s*[-–:]|SCENE\s*[-–:]|\d\s*[.)]\s*)/i, '').trim())
      .filter(l => l.length > 5);

    const characterAnchor = (lines[0] || '').replace(/["""'']/g, '').slice(0, 150);
    const sceneDesc      = (lines[1] || lines[0] || '').replace(/["""'']/g, '').slice(0, 200);

    console.log('[Illustrate] character:', characterAnchor);
    console.log('[Illustrate] scene:', sceneDesc);

    // ─── שלב 2: הרכבת הפרומפט הסופי ─────────────────────────────────────────────
    // סדר קבוע: סגנון → דמות עקבית → סצנה → פרטי איכות
    // SDXL רגיש לסדר — הדמות חייבת לבוא לפני הסצנה לעקביות מרבית
    const stylePrefix  = 'Pixar animation style, Disney Pixar 3D render, highly detailed smooth 3D, cinematic soft lighting, subsurface scattering';
    const stylePostfix = 'expressive cute character, vibrant cheerful colors, children animated movie, octane render, 8k, same character design throughout';
    const negativePrompt = 'different character, character swap, multiple styles, flat, 2D, sketch, painting, ugly, deformed, poorly drawn, bad anatomy, blurry, low quality, dark, scary, adult, text, watermark, logo';
    const fullImagePrompt = `${stylePrefix}, ${characterAnchor}, ${sceneDesc}, ${stylePostfix}`;

    console.log('[Illustrate] full prompt:', fullImagePrompt);

    let dataUrl = null;

    // ─── ניסיון 1: Pollinations.ai – השרת מוריד עם headers של דפדפן ────────────
    try {
      const seed = Math.floor(Math.random() * 999999);
      const encodedPrompt = encodeURIComponent(fullImagePrompt.slice(0, 800));
      const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=512&seed=${seed}&model=flux&nologo=true&enhance=true&nofeed=true`;
      console.log('[Illustrate] Trying Pollinations server-side, seed:', seed);
      console.log('[Illustrate] Pollinations URL:', pollinationsUrl);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 50000);
      const imgRes = await fetch(pollinationsUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://pollinations.ai/',
        },
      });
      clearTimeout(timer);

      if (imgRes.ok) {
        const ct = imgRes.headers.get('content-type') || 'image/jpeg';
        const buf = await imgRes.arrayBuffer();
        const b64 = Buffer.from(buf).toString('base64');
        dataUrl = `data:${ct};base64,${b64}`;
        console.log('[Illustrate] Pollinations OK! size:', Math.round(b64.length / 1024), 'KB');
      } else {
        console.warn('[Illustrate] Pollinations HTTP', imgRes.status);
      }
    } catch (e) {
      console.warn('[Illustrate] Pollinations error:', e.message);
    }

    // ─── ניסיון 2: HuggingFace SDXL – איורים אמיתיים עם מפתח שכבר קיים ──────────
    const HF_KEY = process.env.HF_API_KEY;
    if (!dataUrl && HF_KEY) {
      // נסה כמה מודלים בסדר עדיפות — הראשון שעובד ינצח
      const hfModels = [
        'stabilityai/stable-diffusion-xl-base-1.0',
        'runwayml/stable-diffusion-v1-5',
        'Lykon/dreamshaper-8',
      ];
      for (const model of hfModels) {
        if (dataUrl) break;
        try {
          console.log('[Illustrate] Trying HuggingFace:', model);
          const hfController = new AbortController();
          const hfTimer = setTimeout(() => hfController.abort(), 60000);
          const hfRes = await fetch(
            `https://router.huggingface.co/hf-inference/models/${model}`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${HF_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                inputs: fullImagePrompt.slice(0, 400),
                parameters: {
                  num_inference_steps: 30,
                  guidance_scale: 8.0,
                  negative_prompt: negativePrompt,
                  width: 768,
                  height: 512,
                },
              }),
              signal: hfController.signal,
            }
          );
          clearTimeout(hfTimer);
          if (hfRes.ok) {
            const ct = hfRes.headers.get('content-type') || 'image/jpeg';
            if (ct.startsWith('image/')) {
              const buf = await hfRes.arrayBuffer();
              const b64 = Buffer.from(buf).toString('base64');
              dataUrl = `data:${ct};base64,${b64}`;
              console.log('[Illustrate] HuggingFace OK! model:', model, 'size:', Math.round(b64.length / 1024), 'KB');
            } else {
              const txt = await hfRes.text();
              console.warn('[Illustrate] HuggingFace non-image response:', txt.slice(0, 150));
            }
          } else {
            const herr = await hfRes.text();
            console.warn('[Illustrate] HuggingFace', model, 'failed:', hfRes.status, herr.slice(0, 100));
          }
        } catch (e) {
          console.warn('[Illustrate] HuggingFace', model, 'error:', e.message);
        }
      }
    }

    // ─── ניסיון 3: SVG מפורט דרך Groq (fallback אחרון) ──────────────────────────
    if (!dataUrl) {
      console.log('[Illustrate] Falling back to detailed SVG...');
      const svgRaw = await callAI([
        {
          role: 'system',
          content: `You create beautiful children's book SVG illustrations. Output ONLY valid SVG code, nothing else.
Rules:
- Start with <svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg">
- End with </svg>
- No markdown, no backticks, no comments outside SVG
- Use bright cheerful colors and gradients
- Include: gradient sky background, sun, clouds, grass/ground, a child character with round head + hair + eyes + smile + body + legs + arms, and scene-specific objects
- Use <defs> with <linearGradient> for sky (#87CEEB to #E0F0FF) and ground (#5DBB63 to #7CCD7C)
- Character: circle head (skin tone), hair paths, eyes (dark circles), curved smile path, rounded body rect, leg rects, arm rects
- Make it look cheerful and friendly like a modern children's picture book`
        },
        {
          role: 'user',
          content: `Create a complete children's book illustration SVG for this scene: "${sceneDesc}". ONLY SVG code:`
        }
      ], 4000);
      const svgMatch = svgRaw.match(/<svg[\s\S]*<\/svg>/i);
      if (svgMatch) {
        dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgMatch[0]).toString('base64')}`;
        console.log('[Illustrate] SVG fallback ready');
      } else {
        throw new Error('Could not generate any illustration');
      }
    }

    const assistantMessage = `הנה איור לסיפור שלך! 🎨\n![איור הסיפור](${dataUrl})`;

    await query('INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)', [sessionId, 'user', 'צייר לי את הסיפור!']);
    await query('INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)', [sessionId, 'assistant', assistantMessage]);
    await query('UPDATE sessions SET updated_at = NOW() WHERE id = $1', [sessionId]);
    res.json({ message: assistantMessage });
  } catch (err) {
    console.error('Illustrate error:', err.message);
    res.status(500).json({ error: 'שגיאה ביצירת האיור. נסה שוב.' });
  }
});

export default router;
