import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import ChatMessage from './ChatMessage';

export default function WritingSession({ user, token, onLogout }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const api = axios.create({
    headers: { Authorization: `Bearer ${token}` },
  });

  useEffect(() => {
    loadSession();
  }, [id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const loadSession = async () => {
    try {
      const { data } = await api.get(`/api/sessions/${id}`);
      setSession(data);
      setMessages(data.messages || []);

      // If no messages yet, send initial greeting
      if (!data.messages || data.messages.length === 0) {
        await sendInitialMessage();
      }
    } catch (err) {
      if (err.response?.status === 401) onLogout();
      else if (err.response?.status === 404) navigate('/');
    } finally {
      setInitialLoading(false);
    }
  };

  const sendInitialMessage = async () => {
    setLoading(true);
    try {
      const { data } = await api.post('/api/chat', {
        sessionId: parseInt(id),
        message: 'שלום! אני רוצה להתחיל לכתוב.',
      });

      // Reload messages to get both user and assistant messages from DB
      const sessionData = await api.get(`/api/sessions/${id}`);
      setMessages(sessionData.data.messages || []);
    } catch (err) {
      setError('שגיאה בטעינת הצ\'אט');
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setError('');

    // Optimistically add user message
    const tempUserMsg = { role: 'user', content: userMessage, id: Date.now() };
    setMessages((prev) => [...prev, tempUserMsg]);

    setLoading(true);
    try {
      const { data } = await api.post('/api/chat', {
        sessionId: parseInt(id),
        message: userMessage,
      });

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.message, id: Date.now() + 1 },
      ]);
    } catch (err) {
      if (err.response?.status === 401) {
        onLogout();
        return;
      }
      setError(err.response?.data?.error || 'שגיאה בשליחת ההודעה. נסו שוב.');
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      setInput(userMessage);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const finishWriting = async () => {
    if (loading) return;
    setLoading(true);
    setError('');

    try {
      const { data } = await api.post('/api/chat/finish', {
        sessionId: parseInt(id),
      });

      setMessages((prev) => [
        ...prev,
        { role: 'user', content: 'סיימתי לכתוב! אנא תן לי משוב מסכם.', id: Date.now() },
        { role: 'assistant', content: data.message, id: Date.now() + 1 },
      ]);

      setSession((prev) => ({ ...prev, status: 'completed' }));
    } catch (err) {
      setError('שגיאה בקבלת המשוב');
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <div className="h-screen flex flex-col bg-buddy-bg">
      {/* Header */}
      <header className="bg-white shadow-sm flex-shrink-0">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="text-gray-400 hover:text-buddy-blue transition-colors text-2xl"
            >
              →
            </button>
            <div>
              <h1 className="font-bold text-gray-800">{session?.title}</h1>
              <p className="text-xs text-gray-400">
                {session?.type === 'homework' ? '📝 משימה מהמורה' : '🎨 כתיבה חופשית'}
                {session?.status === 'completed' && ' · הושלם ✨'}
              </p>
            </div>
          </div>

          {session?.status === 'active' && (
            <button
              onClick={finishWriting}
              disabled={loading}
              className="bg-buddy-yellow text-gray-800 px-4 py-2 rounded-xl font-bold text-sm hover:bg-yellow-400 transition-colors shadow disabled:opacity-50"
            >
              🏁 סיימתי!
            </button>
          )}
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto">
          {messages
            .filter((m) => m.role !== 'system')
            .map((message, index) => (
              <ChatMessage key={message.id || index} message={message} />
            ))}

          {/* Loading indicator */}
          {loading && (
            <div className="flex justify-end mb-4 message-enter">
              <div className="bg-white border-2 border-buddy-green rounded-2xl rounded-bl-sm px-5 py-4 shadow-sm">
                <div className="text-xs font-bold text-buddy-green mb-1">
                  ✏️ חבר לכתיבה
                </div>
                <div>
                  <span className="loading-dot"></span>
                  <span className="loading-dot"></span>
                  <span className="loading-dot"></span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 flex-shrink-0">
          <div className="max-w-4xl mx-auto bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 text-center font-semibold text-sm mb-2">
            {error}
          </div>
        </div>
      )}

      {/* Input */}
      {session?.status === 'active' && (
        <div className="bg-white border-t shadow-lg flex-shrink-0">
          <form
            onSubmit={sendMessage}
            className="max-w-4xl mx-auto px-4 py-3 flex gap-3"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(e);
                }
              }}
              className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-lg resize-none focus:border-buddy-blue focus:outline-none transition-colors"
              placeholder="כתבו כאן..."
              rows={2}
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-buddy-blue text-white px-6 rounded-xl font-bold text-lg hover:bg-blue-600 transition-colors shadow disabled:opacity-50 disabled:cursor-not-allowed self-end py-3"
            >
              שליחה
            </button>
          </form>
        </div>
      )}

      {/* Completed banner */}
      {session?.status === 'completed' && (
        <div className="bg-gradient-to-l from-buddy-green to-buddy-blue text-white text-center py-4 font-bold text-lg flex-shrink-0">
          🎉 הכתיבה הושלמה! כל הכבוד!
        </div>
      )}
    </div>
  );
}
