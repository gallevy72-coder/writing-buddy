import { Router } from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { SYSTEM_PROMPT } from '../systemPrompt.js';

const router = Router();
router.use(authenticate);

async function callAI(messages, maxTokens = 1000, model = 'llama-3.3-70b-versatile') {
  const GROQ_KEY = process.env.GROQ_API_KEY;
  const MAX_RETRIES = 4;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: maxTokens,
      }),
    });

    // Rate limit — המתן לפי הנחיית השרת ונסה שוב
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '8');
      const waitMs = (retryAfter + 1) * 1000;
      console.warn(`[Groq] Rate limit (attempt ${attempt + 1}/${MAX_RETRIES}), waiting ${waitMs}ms...`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    if (!response.ok) {
      const err = await response.text();
      console.error('Groq HTTP error:', response.status, err);
      throw new Error(`Groq error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  throw new Error('Groq: rate limit exceeded after retries');
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
    const toolKeywords = ['צייר לי', 'רעיון להמשך', 'נסח מחדש', 'תקן שגיאות', 'מה דעתך', 'סיימתי לכתוב', 'סיימתי לתכנן'];
    const allUserContent = history.filter(m => m.role === 'user').map(m => m.content).join('\n');
    const storyMessages  = history.filter(m => m.role === 'user' && !toolKeywords.some(kw => m.content.includes(kw)));
    const lastStoryMsg   = storyMessages[storyMessages.length - 1]?.content || '';
    const recentScene    = storyMessages.slice(-4).map(m => m.content).join('\n');

    // ─── שלב 1: נעילת תיאורי דמויות ─────────────────────────────────────────────
    // חלץ פעם אחת מתחילת הסיפור ושמור. עדכן רק אם יש דמויות חדשות.
    let characterAnchors = session.character_anchors || null;

    const extractAnchors = async (text) => {
      const res = await callAI([
        {
          role: 'system',
          content: `Extract PERMANENT physical descriptions of every named character from this Hebrew story.
One line per character, English only:
CHARACTER "[exact name as written]": [age]-year-old [boy/girl], [hair color+style] hair, [eye color] eyes, [skin tone], wearing [clothing with exact colors]
Rules: use ONLY details the author explicitly wrote. If a detail is missing, omit it. Never invent.`
        },
        { role: 'user', content: `Story (Hebrew):\n"${text.slice(0, 1500)}"\n\nOutput character lines:` }
      ], 300, 'llama-3.1-8b-instant');
      return res.trim().replace(/["""'']/g, '');
    };

    if (!characterAnchors) {
      // איור ראשון — חלץ מכל הסיפור
      characterAnchors = await extractAnchors(allUserContent);
      await query('UPDATE sessions SET character_anchors = $1 WHERE id = $2', [characterAnchors, sessionId]);
      console.log('[Illustrate] Anchors saved (first time):', characterAnchors);
    } else {
      console.log('[Illustrate] Using saved anchors:', characterAnchors);
    }

    // ─── שלב 2: קריאה אחת — בדיקת דמויות חדשות + פרומפט משולב ─────────────────
    // הכל בקריאה אחת לחיסכון ב-tokens ומניעת rate limit
    const mergedPrompt = (await callAI([
      {
        role: 'system',
        content: `You write a DALL-E 3 illustration prompt for a Hebrew children's story.

TASK A — Check for new characters:
If the latest story text introduces a NEW named character (not in the saved list) WITH physical description details, add them at the start of your output in this format:
NEW_CHARACTER "[name]": [age]-year-old [boy/girl], [hair+style], [eyes], wearing [clothing]
If no new characters with descriptions: skip this part entirely.

TASK B — Write the illustration prompt:
Output ONE English paragraph (100-150 words) after the optional NEW_CHARACTER lines.
For EACH character in the scene, write ONE sentence combining their EXACT appearance with their EXACT current action:
  Example: "Lior, a 9-year-old girl with long blonde braided hair, brown eyes, wearing a yellow top and blue skirt, runs breathlessly toward an old wooden bridge over a rushing stream"
  Wrong: "A girl runs to the bridge" — too vague
  Wrong: "The girl has blonde hair. She runs." — DALL-E ignores separated descriptions

Also describe: location, time of day, atmosphere, key objects — all from the latest text only.
English only. Never invent details not in the text.`
      },
      {
        role: 'user',
        content: `SAVED CHARACTER APPEARANCES (fixed, do not change):\n${characterAnchors}\n\nLATEST STORY TEXT:\n"${lastStoryMsg.slice(0, 700)}"\n\nRecent context:\n"${recentScene.slice(0, 400)}"\n\nOutput:`
      }
    ], 300, 'llama-3.1-8b-instant')).trim().replace(/["""'']/g, '');

    // שמור דמויות חדשות אם נמצאו
    const newCharLines = mergedPrompt.split('\n').filter(l => l.startsWith('NEW_CHARACTER'));
    if (newCharLines.length > 0) {
      const updated = characterAnchors + '\n' + newCharLines.map(l => l.replace('NEW_CHARACTER', 'CHARACTER')).join('\n');
      await query('UPDATE sessions SET character_anchors = $1 WHERE id = $2', [updated, sessionId]);
      console.log('[Illustrate] Added new characters:', newCharLines);
    }

    // הסר שורות NEW_CHARACTER מהפרומפט הסופי
    const cleanPrompt = mergedPrompt.split('\n').filter(l => !l.startsWith('NEW_CHARACTER')).join('\n').trim();
    console.log('[Illustrate] Final prompt:', cleanPrompt);

    // ─── שלב 3: הרכבת הפרומפט הסופי ─────────────────────────────────────────────
    const fullImagePrompt = `Pixar / Disney 3D children's book illustration, cinematic soft lighting, vibrant cheerful colors, 8k quality.

${cleanPrompt}

Art direction: same character design throughout, expressive faces, detailed background faithful to scene description.`;

    console.log('[Illustrate] full prompt:', fullImagePrompt);

    let dataUrl = null;

    // ─── ניסיון 1: OpenAI DALL-E 3 ──────────────────────────────────────────────
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (OPENAI_KEY && !dataUrl) {
      try {
        console.log('[Illustrate] Trying OpenAI DALL-E 3...');
        const dalleController = new AbortController();
        const dalleTimer = setTimeout(() => dalleController.abort(), 60000);
        const dalleRes = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'dall-e-3',
            prompt: fullImagePrompt.slice(0, 3500),
            n: 1,
            size: '1792x1024',
            response_format: 'b64_json',
          }),
          signal: dalleController.signal,
        });
        clearTimeout(dalleTimer);
        if (dalleRes.ok) {
          const dalleData = await dalleRes.json();
          const b64 = dalleData.data[0].b64_json;
          dataUrl = `data:image/png;base64,${b64}`;
          console.log('[Illustrate] DALL-E 3 OK! size:', Math.round(b64.length / 1024), 'KB');
        } else {
          const derr = await dalleRes.text();
          console.warn('[Illustrate] DALL-E 3 failed:', dalleRes.status, derr.slice(0, 150));
        }
      } catch (e) {
        console.warn('[Illustrate] DALL-E 3 error:', e.message);
      }
    } else if (!OPENAI_KEY) {
      console.warn('[Illustrate] OPENAI_API_KEY not set — skipping DALL-E 3');
    }

    // ─── ניסיון 2: HuggingFace FLUX.1-schnell ───────────────────────────────────
    const HF_KEY = process.env.HF_API_KEY;
    if (HF_KEY && !dataUrl) {
      const model = 'black-forest-labs/FLUX.1-schnell';
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
                num_inference_steps: 4,
                guidance_scale: 0.0,
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
            console.log('[Illustrate] HuggingFace OK! size:', Math.round(b64.length / 1024), 'KB');
          } else {
            const txt = await hfRes.text();
            console.warn('[Illustrate] HuggingFace non-image response:', txt.slice(0, 150));
          }
        } else {
          const herr = await hfRes.text();
          console.warn('[Illustrate] HuggingFace failed:', hfRes.status, herr.slice(0, 100));
        }
      } catch (e) {
        console.warn('[Illustrate] HuggingFace error:', e.message);
      }
    } else if (!HF_KEY) {
      console.warn('[Illustrate] HF_API_KEY not set — skipping HuggingFace');
    }

    // ─── ניסיון 2: SVG מפורט דרך Groq (fallback אחרון) ──────────────────────────
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
          content: `Create a children's book illustration SVG for this scene: "${cleanPrompt.slice(0, 500)}". Include ALL characters. ONLY SVG code:`
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
