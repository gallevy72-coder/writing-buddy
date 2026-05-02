import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import ChatMessage from './ChatMessage';

// =============================================
// קבועים - מחוץ לקומפוננטה
// =============================================

// הודעת מעבר מתכנון לכתיבה
const KICKOFF_MESSAGE = 'סיימתי לתכנן! אני מוכן/ה להתחיל לכתוב את הסיפור.';

// ברכת פתיחה לשלב התכנון
const GREETING_FRAMEWORK =
  'שלום! אני החבר לכתיבה שלך ✏️\n\nלפני שנכתוב, בואו נבנה יחד **תכנית** קצרה לסיפור – זה יעזור לך לכתוב הרבה יותר טוב! 📋\n\nשאלה ראשונה: **מי הגיבור/ה של הסיפור שלך? מה שמו/שמה?** 😊';

// כל הודעות ה"כלים" שלא נספרות כסיפור
const TOOL_MESSAGES = new Set([
  'אני צריך רעיון להמשך הסיפור. תן לי רעיון יצירתי שמתאים למה שכתבתי עד עכשיו.',
  "עזור לי לנסח מחדש את מה שכתבתי. תציע ניסוח משופר שמתאים לכיתה ד'.",
  'בדוק את מה שכתבתי ותקן שגיאות כתיב, פיסוק ודקדוק.',
  'מה דעתך על מה שכתבתי עד עכשיו? תן לי משוב קצר - מה טוב ומה אפשר לשפר.',
  'צייר לי את הסיפור!',
  'סיימתי לכתוב! אנא תן לי משוב מסכם.',
  KICKOFF_MESSAGE,
]);

// ספירת משפטים חכמה לעברית
function countSentences(text) {
  if (!text || !text.trim()) return 0;
  const segments = text.split(/[.!?]+\s*|\r?\n+/);
  let count = 0;
  segments.forEach(seg => {
    const words = seg.trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length >= 2) {
      count += Math.ceil(words.length / 15);
    }
  });
  return count;
}

// =============================================
// קומפוננטה ראשית
// =============================================
export default function WritingSession({ user, token, onLogout }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const [toolUses, setToolUses] = useState({ idea: 0, rephrase: 0, fix: 0, opinion: 0, illustrate: 0 });
  const [showFinishPopup, setShowFinishPopup] = useState(false);
  const [storySaved, setStorySaved] = useState(false);
  const [editableStory, setEditableStory] = useState('');
  const [copied, setCopied] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);

  // writingStartIndex: null = שלב תכנון, מספר = שלב כתיבה
  // (מייצג כמה הודעות-משתמש-לא-כלי היו בשלב התכנון)
  const [writingStartIndex, setWritingStartIndex] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const SENTENCE_GOAL = 15;

  // גבולות שימוש בכלים: איור = ללא הגבלה
  const toolLimits = { idea: 2, rephrase: 2, fix: 2, opinion: 2, illustrate: Infinity };

  const tools = [
    { key: 'idea',      label: 'רעיון',     emoji: '💡', color: 'bg-purple-500', hasLimit: true,  message: 'אני צריך רעיון להמשך הסיפור. תן לי רעיון יצירתי שמתאים למה שכתבתי עד עכשיו.' },
    { key: 'rephrase',  label: 'ניסוח',     emoji: '✍️', color: 'bg-green-500',  hasLimit: true,  message: "עזור לי לנסח מחדש את מה שכתבתי. תציע ניסוח משופר שמתאים לכיתה ד'." },
    { key: 'fix',       label: 'תיקון',     emoji: '🔧', color: 'bg-blue-600',   hasLimit: true,  message: 'בדוק את מה שכתבתי ותקן שגיאות כתיב, פיסוק ודקדוק.' },
    { key: 'opinion',   label: 'מה דעתך?', emoji: '❓', color: 'bg-yellow-500', hasLimit: true,  message: 'מה דעתך על מה שכתבתי עד עכשיו? תן לי משוב קצר - מה טוב ומה אפשר לשפר.' },
    { key: 'illustrate',label: 'איור',      emoji: '🎨', color: 'bg-orange-400', hasLimit: false, message: 'תאר לי ציור שמתאים לסיפור שכתבתי עד עכשיו.' },
  ];

  const [illustrating, setIllustrating] = useState(false); // מצב המתנה ספציפי לאיור

  const api = axios.create({
    headers: { Authorization: `Bearer ${token}` },
    timeout: 180000, // 3 דקות — מספיק גם להפעלה מחדש של Render (50+ שניות cold start)
  });

  useEffect(() => { loadSession(); }, [id]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  // =============================================
  // חישובים: רק הודעות הסיפור (לא מסגרת / לא כלים)
  // =============================================
  const getAllUserWritingMsgs = (msgs = messages) =>
    msgs.filter(m => m.role === 'user' && !TOOL_MESSAGES.has(m.content));

  const getStoryText = () => {
    const all = getAllUserWritingMsgs();
    const storyMsgs = writingStartIndex !== null ? all.slice(writingStartIndex) : [];
    return storyMsgs.map(m => m.content).join('\n');
  };

  const sentenceCount = countSentences(getStoryText());
  const progress = Math.min((sentenceCount / SENTENCE_GOAL) * 100, 100);

  const getMilestoneEmoji = () => {
    if (sentenceCount >= 15) return '🏆';
    if (sentenceCount >= 12) return '🌟';
    if (sentenceCount >= 8)  return '⭐';
    if (sentenceCount >= 4)  return '✨';
    return '📝';
  };

  const getProgressColor = () => {
    if (progress >= 100) return 'from-yellow-400 to-green-500';
    if (progress >= 75)  return 'from-green-400 to-green-500';
    if (progress >= 50)  return 'from-blue-400 to-green-400';
    return 'from-buddy-blue to-blue-400';
  };

  // =============================================
  // טעינת סשן
  // =============================================
  const loadSession = async () => {
    try {
      const { data } = await api.get(`/api/sessions/${id}`);
      setSession(data);
      const msgs = data.messages || [];

      if (msgs.length === 0) {
        // סשן חדש – מתחילים בשלב תכנון
        setMessages([{ role: 'assistant', content: GREETING_FRAMEWORK, id: 'greeting' }]);
        setWritingStartIndex(null);
      } else {
        setMessages(msgs);
        // מחפשים הודעת KICKOFF כדי לדעת איפה מתחיל הסיפור
        const kickoffIdx = msgs.findIndex(m => m.role === 'user' && m.content === KICKOFF_MESSAGE);
        if (kickoffIdx !== -1) {
          const userMsgsBeforeKickoff = msgs.slice(0, kickoffIdx).filter(
            m => m.role === 'user' && !TOOL_MESSAGES.has(m.content)
          ).length;
          setWritingStartIndex(userMsgsBeforeKickoff);
        } else if (msgs.some(m => m.role === 'user')) {
          // סשן ישן (לפני העדכון) – כל ההודעות נחשבות סיפור
          setWritingStartIndex(0);
        }
        // אחרת – נשאר בשלב תכנון
      }
    } catch (err) {
      if (err.response?.status === 401) onLogout();
      else if (err.response?.status === 404) navigate('/');
    } finally {
      setInitialLoading(false);
    }
  };

  // =============================================
  // שליחת הודעה רגילה
  // =============================================
  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const userMessage = input.trim();
    setInput('');
    setError('');
    const tempUserMsg = { role: 'user', content: userMessage, id: Date.now() };
    setMessages(prev => [...prev, tempUserMsg]);
    setLoading(true);
    try {
      const { data } = await api.post('/api/chat', { sessionId: parseInt(id), message: userMessage });
      setMessages(prev => [...prev, { role: 'assistant', content: data.message, id: Date.now() + 1 }]);
    } catch (err) {
      if (err.response?.status === 401) { onLogout(); return; }
      setError(err.response?.data?.error || 'שגיאה בשליחת ההודעה. נסו שוב.');
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
      setInput(userMessage);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  // =============================================
  // מעבר מתכנון לכתיבה
  // =============================================
  const startWriting = async () => {
    if (loading) return;
    // כמה הודעות-כתיבה כבר נשלחו בשלב התכנון
    const currentUserMsgCount = getAllUserWritingMsgs().length;
    setWritingStartIndex(currentUserMsgCount); // הסיפור מתחיל מהמשפט הבא

    const tempMsg = { role: 'user', content: KICKOFF_MESSAGE, id: Date.now() };
    setMessages(prev => [...prev, tempMsg]);
    setLoading(true);
    try {
      const { data } = await api.post('/api/chat', { sessionId: parseInt(id), message: KICKOFF_MESSAGE });
      setMessages(prev => [...prev, { role: 'assistant', content: data.message, id: Date.now() + 1 }]);
    } catch (err) {
      if (err.response?.status === 401) { onLogout(); return; }
      setError('שגיאה. נסו שוב.');
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
      setWritingStartIndex(null); // חזרה לשלב תכנון
    } finally { setLoading(false); setTimeout(() => inputRef.current?.focus(), 50); }
  };

  // =============================================
  // שליחת הודעות כלים
  // =============================================
  const sendToolMessage = async (tool) => {
    const limit = toolLimits[tool.key] ?? 2;
    if (loading || toolUses[tool.key] >= limit) return;
    setToolUses(prev => ({ ...prev, [tool.key]: prev[tool.key] + 1 }));
    setError('');

    if (tool.key === 'illustrate') {
      const tempUserMsg = { role: 'user', content: 'צייר לי את הסיפור!', id: Date.now() };
      setMessages(prev => [...prev, tempUserMsg]);
      setLoading(true);
      setIllustrating(true);
      try {
        const { data } = await api.post('/api/chat/illustrate', { sessionId: parseInt(id) });
        setMessages(prev => [...prev, { role: 'assistant', content: data.message, id: Date.now() + 1 }]);
      } catch (err) {
        if (err.response?.status === 401) { onLogout(); return; }
        setError('שגיאה ביצירת האיור. נסו שוב.');
        setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
        setToolUses(prev => ({ ...prev, illustrate: prev.illustrate - 1 }));
      } finally { setLoading(false); setIllustrating(false); setTimeout(() => inputRef.current?.focus(), 50); }
      return;
    }

    const tempUserMsg = { role: 'user', content: tool.message, id: Date.now() };
    setMessages(prev => [...prev, tempUserMsg]);
    setLoading(true);
    try {
      const { data } = await api.post('/api/chat', { sessionId: parseInt(id), message: tool.message });
      setMessages(prev => [...prev, { role: 'assistant', content: data.message, id: Date.now() + 1 }]);
    } catch (err) {
      if (err.response?.status === 401) { onLogout(); return; }
      setError(err.response?.data?.error || 'שגיאה בשליחת ההודעה. נסו שוב.');
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
      setToolUses(prev => ({ ...prev, [tool.key]: prev[tool.key] - 1 }));
    } finally { setLoading(false); setTimeout(() => inputRef.current?.focus(), 50); }
  };

  // =============================================
  // חלון סיום
  // =============================================
  const openFinishPopup = () => {
    const fresh = getStoryText();
    const saved = session?.story_text;

    if (saved) {
      // יש גרסה שמורה — השתמש בה (המשתמש ערך אותה בכוונה)
      // אם נוספו משפטים חדשים בצ'אט מאז השמירה, הוסף אותם בסוף
      const freshLines = fresh.split('\n').map(l => l.trim()).filter(Boolean);
      const savedLines = saved.split('\n').map(l => l.trim()).filter(Boolean);
      const newLines = freshLines.filter(line =>
        line.length > 10 && !savedLines.some(sl => sl.includes(line.slice(0, 20)))
      );
      const merged = newLines.length > 0
        ? saved + '\n\n' + newLines.join('\n')
        : saved;
      setEditableStory(merged);
    } else {
      // אין גרסה שמורה — בנה מהמשפטים
      setEditableStory(fresh);
    }

    setCopied(false);
    setStorySaved(false);
    setShowFinishPopup(true);
  };

  const saveStoryText = async () => {
    try {
      await api.patch(`/api/sessions/${id}`, { story_text: editableStory });
      setSession(prev => ({ ...prev, story_text: editableStory }));
      setStorySaved(true);
      setTimeout(() => setStorySaved(false), 2500);
    } catch {
      setError('שגיאה בשמירה');
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(editableStory).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const handleWhatsApp = () => {
    const encoded = encodeURIComponent('✏️ הסיפור שלי:\n\n' + editableStory);
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
  };

  // חילוץ כל האיורים מתוך ההודעות
  const getGalleryImages = () => {
    const imgRegex = /!\[([^\]]*)\]\((data:[^)]{10,}|https?:\/\/[^\s)]+)\)/g;
    const images = [];
    messages.forEach((msg, msgIdx) => {
      if (msg.role !== 'assistant') return;
      let match;
      imgRegex.lastIndex = 0;
      while ((match = imgRegex.exec(msg.content)) !== null) {
        images.push({ src: match[2], alt: match[1], index: images.length });
      }
    });
    return images;
  };

  const reopenSession = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await api.patch(`/api/sessions/${id}`, { status: 'active' });
      setSession(prev => ({ ...prev, status: 'active' }));
      // אפס שימוש בכלים כדי שהילד יוכל להשתמש בהם שוב
      setToolUses({ idea: 0, rephrase: 0, fix: 0, opinion: 0, illustrate: 0 });
      // הוסף הודעת מערכת שתודיע שהסיפור נפתח מחדש
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'הסיפור נפתח מחדש לכתיבה ✏️ אפשר להמשיך!',
          id: Date.now(),
        },
      ]);
    } catch (err) {
      if (err.response?.status === 401) { onLogout(); return; }
      setError('שגיאה בפתיחת הסיפור מחדש');
    } finally { setLoading(false); }
  };

  const finishWriting = async () => {
    setShowFinishPopup(false);
    setShowFinishConfirm(false);
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/api/chat/finish', { sessionId: parseInt(id) });
      setMessages(prev => [
        ...prev,
        { role: 'user', content: 'סיימתי לכתוב! אנא תן לי משוב מסכם.', id: Date.now() },
        { role: 'assistant', content: data.message, id: Date.now() + 1 },
      ]);
      setSession(prev => ({ ...prev, status: 'completed' }));
    } catch (err) {
      setError('שגיאה בקבלת המשוב');
    } finally { setLoading(false); }
  };

  // =============================================
  // טעינה ראשונית
  // =============================================
  if (initialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-buddy-bg">
        <div className="text-center">
          <div className="loading-dot"></div>
          <div className="loading-dot"></div>
          <div className="loading-dot"></div>
          <p className="mt-4 text-gray-500">טוען...</p>
        </div>
      </div>
    );
  }

  const isFrameworkPhase = writingStartIndex === null;

  // =============================================
  // רינדור
  // =============================================
  return (
    <div className="h-screen flex flex-col bg-buddy-bg">

      {/* ===== חלון קופץ: הסיפור שלי ===== */}
      {showFinishPopup && (
        <div
          className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4"
          dir="rtl"
          onClick={e => {
            if (e.target === e.currentTarget) {
              setShowFinishPopup(false);
              setShowFinishConfirm(false);
            }
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-800">✏️ הסיפור שלי</h2>
              <button
                onClick={() => { setShowFinishPopup(false); setShowFinishConfirm(false); }}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
              >✕</button>
            </div>

            {/* ── שלב אישור לפני סיום ── */}
            {showFinishConfirm ? (
              <div className="p-6 flex-1 flex flex-col items-center justify-center gap-4 text-center">
                <span className="text-5xl">🏁</span>
                <h3 className="text-lg font-bold text-gray-800">רגע לפני שמסיימים...</h3>
                <p className="text-gray-600 text-sm max-w-sm">
                  לאחר קבלת המשוב הסיפור <strong>יינעל</strong> ולא ניתן יהיה להמשיך לכתוב בו.
                  <br />
                  האם אתה בטוח שסיימת?
                </p>
                <div className="flex gap-3 mt-2">
                  <button
                    onClick={() => setShowFinishConfirm(false)}
                    className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-2.5 rounded-xl font-bold text-sm transition-colors"
                  >
                    ← המשך לכתוב
                  </button>
                  <button
                    onClick={finishWriting}
                    className="bg-buddy-yellow hover:bg-yellow-400 text-gray-800 px-5 py-2.5 rounded-xl font-bold text-sm transition-colors shadow"
                  >
                    ✅ כן, סיימתי! קבל משוב
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="p-4 flex-1 overflow-y-auto">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-gray-500">אפשר לערוך ולתקן לפני ששולחים:</p>
                    {session?.story_text && (
                      <button
                        onClick={() => setEditableStory(getStoryText())}
                        className="text-xs text-gray-400 hover:text-gray-600 underline"
                        title="החזר לגרסה המקורית מהסיפור"
                      >
                        🔄 רענן מהסיפור
                      </button>
                    )}
                  </div>
                  <textarea
                    value={editableStory}
                    onChange={e => setEditableStory(e.target.value)}
                    className="w-full border-2 border-gray-200 rounded-xl p-3 text-base resize-none focus:border-buddy-blue focus:outline-none transition-colors min-h-[200px]"
                    dir="rtl"
                    placeholder="הטקסט שכתבת יופיע כאן..."
                  />
                  <p className="text-xs text-gray-400 mt-1">{countSentences(editableStory)} משפטים</p>
                </div>
                <div className="p-4 border-t flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={saveStoryText}
                      className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm transition-colors shadow"
                    >
                      {storySaved ? '✅ נשמר!' : '💾 שמור'}
                    </button>
                    <button onClick={handleCopy} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl font-bold text-sm transition-colors">
                      {copied ? '✅ הועתק!' : '📋 העתקה'}
                    </button>
                    <button onClick={handleWhatsApp} className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-xl font-bold text-sm transition-colors">
                      💬 WhatsApp
                    </button>
                  </div>
                  <button
                    onClick={() => setShowFinishConfirm(true)}
                    className="bg-buddy-yellow hover:bg-yellow-400 text-gray-800 px-6 py-2 rounded-xl font-bold text-sm transition-colors shadow"
                  >
                    🏁 קבל משוב מה-AI
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== חלון קופץ: גלריית איורים ===== */}
      {showGallery && (() => {
        const galleryImages = getGalleryImages();
        return (
          <div
            className="fixed inset-0 bg-black bg-opacity-70 z-50 flex items-center justify-center p-4"
            dir="rtl"
            onClick={e => { if (e.target === e.currentTarget) setShowGallery(false); }}
          >
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
              <div className="p-4 border-b flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-800">🖼️ גלריית האיורים</h2>
                <button
                  onClick={() => setShowGallery(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
                >✕</button>
              </div>
              <div className="p-4 flex-1 overflow-y-auto">
                {galleryImages.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <div className="text-5xl mb-3">🎨</div>
                    <p className="font-semibold">עוד אין איורים</p>
                    <p className="text-sm mt-1">לחצו על כפתור האיור ליצירת איורים לסיפור</p>
                  </div>
                ) : (
                  <div className={`grid gap-4 ${galleryImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    {galleryImages.map((img, i) => (
                      <div key={i} className="rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                        <img src={img.src} alt={img.alt} className="w-full h-auto block" />
                        <div className="bg-gray-50 px-3 py-1.5 text-xs text-gray-500 text-center">
                          איור {i + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== כותרת ===== */}
      <header className="bg-white shadow-sm flex-shrink-0">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="text-gray-400 hover:text-buddy-blue transition-colors text-2xl">→</button>
            <div>
              <h1 className="font-bold text-gray-800">{session?.title}</h1>
              <p className="text-xs text-gray-400">
                {session?.type === 'homework' ? '📝 משימה מהמורה' : '🎨 כתיבה חופשית'}
                {session?.status === 'completed' && ' · הושלם ✨'}
              </p>
            </div>
          </div>
          {/* כפתורי כותרת — שלב כתיבה */}
          {session?.status === 'active' && !isFrameworkPhase && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowGallery(true)}
                className="bg-orange-100 hover:bg-orange-200 text-orange-700 px-3 py-2 rounded-xl font-bold text-sm transition-colors shadow flex items-center gap-1"
                title="גלריית האיורים"
              >
                🖼️ גלריה
              </button>
              <button
                onClick={openFinishPopup}
                disabled={loading}
                className="bg-buddy-yellow text-gray-800 px-4 py-2 rounded-xl font-bold text-sm hover:bg-yellow-400 transition-colors shadow disabled:opacity-50"
              >
                🏁 סיימתי!
              </button>
            </div>
          )}
          {/* כפתור גלריה גם כשהסיפור הושלם */}
          {session?.status === 'completed' && (
            <button
              onClick={() => setShowGallery(true)}
              className="bg-orange-100 hover:bg-orange-200 text-orange-700 px-3 py-2 rounded-xl font-bold text-sm transition-colors shadow"
            >
              🖼️ גלריה
            </button>
          )}
          {/* אינדיקטור שלב תכנון בכותרת */}
          {session?.status === 'active' && isFrameworkPhase && (
            <span className="text-xs text-purple-700 font-semibold bg-purple-100 px-3 py-1.5 rounded-full">
              📋 שלב תכנון
            </span>
          )}
        </div>
      </header>

      {/* ===== אזור שיחה ===== */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto">
          {messages.filter(m => m.role !== 'system').map((message, index) => (
            <ChatMessage key={message.id || index} message={message} />
          ))}
          {loading && (
            <div className="flex justify-end mb-4 message-enter">
              <div className="bg-white border-2 border-buddy-green rounded-2xl rounded-bl-sm px-5 py-4 shadow-sm max-w-[80%]">
                <div className="text-xs font-bold text-buddy-green mb-1">✏️ חבר לכתיבה</div>
                {illustrating ? (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="text-xl animate-spin">🎨</span>
                    <span>מצייר עכשיו... זה לוקח עד חצי דקה ✨</span>
                  </div>
                ) : (
                  <div>
                    <span className="loading-dot"></span>
                    <span className="loading-dot"></span>
                    <span className="loading-dot"></span>
                  </div>
                )}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ===== שגיאה ===== */}
      {error && (
        <div className="px-4 flex-shrink-0">
          <div className="max-w-4xl mx-auto bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 text-center font-semibold text-sm mb-2">{error}</div>
        </div>
      )}

      {/* ===== פאנל תחתון ===== */}
      {session?.status === 'active' && (
        <div className="bg-white border-t shadow-lg flex-shrink-0">

          {/* --- שלב תכנון --- */}
          {isFrameworkPhase && (
            <>
              <div className="max-w-4xl mx-auto px-4 pt-3 pb-1">
                <div className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-2 flex items-center justify-between">
                  <span className="text-sm text-purple-700 font-semibold">📋 שלב 1: בניית מסגרת הסיפור</span>
                  <span className="text-xs text-purple-500">ענה/י על השאלות ואז לחץ/י על הכפתור הירוק</span>
                </div>
              </div>
              <form onSubmit={sendMessage} className="max-w-4xl mx-auto px-4 py-3 flex gap-3">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e); } }}
                  className="flex-1 border-2 border-purple-200 rounded-xl px-4 py-3 text-lg resize-none focus:border-purple-400 focus:outline-none transition-colors"
                  placeholder="כתבו כאן את תשובתכם..."
                  rows={2}
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="bg-purple-500 text-white px-6 rounded-xl font-bold text-lg hover:bg-purple-600 transition-colors shadow disabled:opacity-50 disabled:cursor-not-allowed self-end py-3"
                >שליחה</button>
              </form>
              <div className="max-w-4xl mx-auto px-4 pb-3 flex justify-center">
                <button
                  onClick={startWriting}
                  disabled={loading}
                  className="bg-green-500 hover:bg-green-600 text-white px-8 py-2.5 rounded-xl font-bold text-sm transition-colors shadow disabled:opacity-50"
                >
                  ✅ יש לי תכנית! מוכן/ה להתחיל לכתוב →
                </button>
              </div>
            </>
          )}

          {/* --- שלב כתיבה --- */}
          {!isFrameworkPhase && (
            <>
              {/* סרגל התקדמות */}
              <div className="max-w-4xl mx-auto px-4 pt-3 pb-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-gray-600">
                    {getMilestoneEmoji()} {sentenceCount} משפטים
                    {sentenceCount >= SENTENCE_GOAL && <span className="mr-1 text-green-600"> · כל הכבוד! 🎉</span>}
                    {sentenceCount >= 12 && sentenceCount < SENTENCE_GOAL && <span className="mr-1 text-blue-500"> · כמעט שם!</span>}
                  </span>
                  <span className="text-xs text-gray-400">יעד: {SENTENCE_GOAL} משפטים</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div
                    className={`h-3 rounded-full transition-all duration-500 bg-gradient-to-r ${getProgressColor()}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* שדה כתיבה */}
              <form onSubmit={sendMessage} className="max-w-4xl mx-auto px-4 py-3 flex gap-3">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e); } }}
                  className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-lg resize-none focus:border-buddy-blue focus:outline-none transition-colors"
                  placeholder="כתבו כאן את הסיפור..."
                  rows={2}
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="bg-buddy-blue text-white px-6 rounded-xl font-bold text-lg hover:bg-blue-600 transition-colors shadow disabled:opacity-50 disabled:cursor-not-allowed self-end py-3"
                >שליחה</button>
              </form>

              {/* כלים */}
              <div className="max-w-4xl mx-auto px-4 pb-3 flex justify-center gap-2">
                {tools.map(tool => {
                  const limit = toolLimits[tool.key] ?? 2;
                  const remaining = limit - toolUses[tool.key];
                  const disabled = loading || (tool.hasLimit && remaining <= 0);
                  return (
                    <button
                      key={tool.key}
                      onClick={() => sendToolMessage(tool)}
                      disabled={disabled}
                      className={`${tool.color} text-white px-3 py-2 rounded-xl font-bold text-sm flex flex-col items-center gap-0.5 min-w-[60px] transition-all shadow ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:scale-105 hover:shadow-md'}`}
                    >
                      <span className="text-lg">{tool.emoji}</span>
                      <span className="text-xs">{tool.label}</span>
                      {tool.hasLimit && remaining > 0 && (
                        <span className="text-[10px] opacity-80">({remaining})</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ===== הושלם ===== */}
      {session?.status === 'completed' && (
        <div className="bg-white border-t shadow-lg flex-shrink-0" dir="rtl">
          <div className="max-w-4xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-green-700 font-bold text-base">
              <span className="text-2xl">🎉</span>
              <span>הכתיבה הושלמה! כל הכבוד!</span>
            </div>
            <div className="flex gap-2 flex-wrap justify-center">
              <button
                onClick={() => setShowGallery(true)}
                className="bg-orange-100 hover:bg-orange-200 text-orange-700 px-4 py-2 rounded-xl font-bold text-sm transition-colors shadow"
              >
                🖼️ גלריית איורים
              </button>
              <button
                onClick={openFinishPopup}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl font-bold text-sm transition-colors shadow"
              >
                📋 הצג את הסיפור
              </button>
              <button
                onClick={reopenSession}
                disabled={loading}
                className="bg-buddy-blue hover:bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm transition-colors shadow disabled:opacity-50"
              >
                ✏️ פתח מחדש לכתיבה
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
