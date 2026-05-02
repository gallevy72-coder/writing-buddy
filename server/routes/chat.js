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
    const toolKeywords = ['צייר לי', 'רעיון להמשך', 'נסח מחדש', 'תקן שגיאות', 'מה דעתך', 'סיימתי לכתוב', 'סיימתי לתכנן'];
    const allUserContent = history.filter(m => m.role === 'user').map(m => m.content).join('\n');
    const storyMessages  = history.filter(m => m.role === 'user' && !toolKeywords.some(kw => m.content.includes(kw)));
    const lastStoryMsg   = storyMessages[storyMessages.length - 1]?.content || '';
    const recentScene    = storyMessages.slice(-4).map(m => m.content).join('\n');

    // ─── שלב 1: תיאורי דמויות — חלץ פעם אחת ושמור לנצח ─────────────────────────
    // אם כבר יש anchors שמורים לסשן הזה — השתמש בהם ישירות ללא חילוץ מחדש.
    // זה מבטיח שהדמויות זהות בכל האיורים של אותו סיפור.
    let characterAnchors = session.character_anchors || null;

    if (!characterAnchors) {
      console.log('[Illustrate] Extracting character anchors for the first time...');
      const characterPrompt = [
        {
          role: 'system',
          content: `You extract PERMANENT character descriptions from a Hebrew children's story for use in AI image generation.
For EVERY named character in the story, output their fixed physical description from their FIRST mention.

Output format — one line per character, English only, no Hebrew:
CHARACTER "[name]": [age]-year-old [boy/girl], [hair color] [hair style] hair, [eye color] eyes, [skin tone] skin, always wearing [specific clothing with colors]

Critical rules:
- Use ONLY details explicitly written by the author — NEVER invent or assume appearance
- Be very specific: "curly red hair" not just "red hair", "bright green eyes" not just "eyes"
- Include clothing details exactly as written — these anchor the character design
- If a detail is not mentioned in the text, skip it rather than guessing
- These anchors will be reused unchanged for every illustration in this story`
        },
        {
          role: 'user',
          content: `Full story text (Hebrew):\n"${allUserContent.slice(0, 1500)}"\n\nOutput character anchors:`
        }
      ];
      characterAnchors = (await callAI(characterPrompt, 250)).trim().replace(/["""'']/g, '');
      // שמור לבסיס הנתונים — לא יחולץ שוב
      await query('UPDATE sessions SET character_anchors = $1 WHERE id = $2', [characterAnchors, sessionId]);
      console.log('[Illustrate] Character anchors saved:', characterAnchors);
    } else {
      console.log('[Illustrate] Using saved character anchors:', characterAnchors);
    }

    // ─── שלב 2: חילוץ הסצנה הנוכחית — ספציפי ומפורט ────────────────────────────
    const scenePrompt = [
      {
        role: 'system',
        content: `You are writing a detailed scene description for an AI image generator, based on the latest paragraph of a Hebrew children's story.

Output ONE English paragraph (80-120 words) that describes ONLY the current moment. Be extremely specific.

You MUST include ALL of these:
1. LOCATION: exact place — describe the environment in detail (indoors/outdoors, what kind of room/forest/street, time of day, weather, colors of the surroundings)
2. ACTION: exactly what each character is doing RIGHT NOW — their body position, gesture, expression, movement direction
3. OBJECTS: every object mentioned in the latest writing — where it is, what it looks like
4. ATMOSPHERE: mood, lighting, energy of the scene

DO NOT:
- Describe character appearance (hair, clothing, etc.) — that is handled separately
- Summarize the whole story
- Invent details not in the text
- Be vague ("outside", "somewhere") — always be specific

English only, no Hebrew, no labels.`
      },
      {
        role: 'user',
        content: `THE LATEST PARAGRAPH (illustrate THIS):\n"${lastStoryMsg.slice(0, 800)}"\n\nRecent story context:\n"${recentScene.slice(0, 600)}"\n\nWrite the detailed scene description:`
      }
    ];

    const currentScene = (await callAI(scenePrompt, 200)).trim().replace(/["""'']/g, '');
    console.log('[Illustrate] Current scene:', currentScene);

    // ─── שלב 3: הרכבת הפרומפט הסופי — סצנה ראשונה, דמויות שניות ────────────────
    // סצנה בא ראשון כי DALL-E 3 נותן משקל גבוה יותר לתחילת הפרומפט
    const fullImagePrompt = `Pixar / Disney 3D children's book illustration style, cinematic soft lighting, vibrant colors, 8k.

ILLUSTRATE THIS EXACT SCENE:
${currentScene}

CHARACTER APPEARANCES — every character must look EXACTLY like this, no exceptions:
${characterAnchors}

STRICT RULES:
- The scene description above is the absolute truth — illustrate it faithfully, every detail
- Characters must match their descriptions exactly: same face, same hair, same clothing
- Show ALL characters who are present in the scene
- The background and environment must match the scene description precisely
- This is a NEW scene — do not repeat a previous illustration`;

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
          content: `Create a complete children's book illustration SVG. Characters: "${characterAnchors.slice(0, 300)}". Scene: "${currentScene.slice(0, 300)}". Include ALL characters. ONLY SVG code:`
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
