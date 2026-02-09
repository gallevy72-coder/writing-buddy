import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function Dashboard({ user, token, onLogout }) {
  const [sessions, setSessions] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('homework');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const api = axios.create({
    headers: { Authorization: `Bearer ${token}` },
  });

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const { data } = await api.get('/api/sessions');
      setSessions(data);
    } catch (err) {
      if (err.response?.status === 401) onLogout();
    } finally {
      setLoading(false);
    }
  };

  const createSession = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setError('');
    try {
      const { data } = await api.post('/api/sessions', {
        title: newTitle.trim(),
        type: newType,
      });
      navigate(`/session/${data.id}`);
    } catch (err) {
      if (err.response?.status === 401) onLogout();
      else setError(err.response?.data?.error || err.message || 'שגיאה ביצירת סשן');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-yellow-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">✏️</span>
            <div>
              <h1 className="text-xl font-bold text-buddy-blue">חבר לכתיבה</h1>
              <p className="text-sm text-gray-500">שלום, {user?.displayName}!</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="text-gray-400 hover:text-red-500 transition-colors px-3 py-1 rounded-lg hover:bg-red-50"
          >
            יציאה
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* New Session Button */}
        <button
          onClick={() => setShowNew(!showNew)}
          className="w-full bg-gradient-to-l from-buddy-blue to-buddy-green text-white rounded-2xl p-6 text-xl font-bold shadow-lg hover:shadow-xl transition-all hover:scale-[1.01] mb-8 flex items-center justify-center gap-3"
        >
          <span className="text-2xl">🚀</span>
          התחלת כתיבה חדשה!
        </button>

        {/* New Session Form */}
        {showNew && (
          <form
            onSubmit={createSession}
            className="bg-white rounded-2xl shadow-lg p-6 mb-8 message-enter"
          >
            <h3 className="text-lg font-bold text-gray-700 mb-4">מה נכתוב היום?</h3>

            <div className="mb-4">
              <label className="block text-gray-600 font-semibold mb-2">כותרת</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:border-buddy-blue focus:outline-none"
                placeholder="למשל: חיבור על החופשה שלי"
                required
              />
            </div>

            <div className="mb-6">
              <label className="block text-gray-600 font-semibold mb-2">סוג הכתיבה</label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setNewType('homework')}
                  className={`flex-1 py-3 rounded-xl text-lg font-semibold border-2 transition-all ${
                    newType === 'homework'
                      ? 'border-buddy-blue bg-blue-50 text-buddy-blue'
                      : 'border-gray-200 text-gray-500'
                  }`}
                >
                  📝 משימה מהמורה
                </button>
                <button
                  type="button"
                  onClick={() => setNewType('free')}
                  className={`flex-1 py-3 rounded-xl text-lg font-semibold border-2 transition-all ${
                    newType === 'free'
                      ? 'border-buddy-green bg-green-50 text-buddy-green'
                      : 'border-gray-200 text-gray-500'
                  }`}
                >
                  🎨 כתיבה חופשית
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 text-center font-semibold mb-4">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-buddy-blue text-white py-3 rounded-xl text-lg font-bold hover:bg-blue-600 transition-colors"
            >
              בואו נתחיל! ✨
            </button>
          </form>
        )}

        {/* Sessions List */}
        <h2 className="text-lg font-bold text-gray-700 mb-4">הכתיבות שלי</h2>

        {loading ? (
          <div className="text-center py-12">
            <div className="loading-dot"></div>
            <div className="loading-dot"></div>
            <div className="loading-dot"></div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl shadow">
            <div className="text-5xl mb-4">📝</div>
            <p className="text-gray-500 text-lg">עדיין אין כתיבות. בואו נתחיל!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => navigate(`/session/${session.id}`)}
                className="w-full bg-white rounded-2xl shadow hover:shadow-lg transition-all p-5 flex items-center gap-4 text-right hover:scale-[1.01]"
              >
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${
                    session.status === 'completed'
                      ? 'bg-green-100'
                      : 'bg-blue-100'
                  }`}
                >
                  {session.status === 'completed' ? '✅' : session.type === 'homework' ? '📝' : '🎨'}
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-gray-800">{session.title}</h3>
                  <p className="text-sm text-gray-400">
                    {session.type === 'homework' ? 'משימה מהמורה' : 'כתיבה חופשית'}
                    {' · '}
                    {session.message_count || 0} הודעות
                    {session.status === 'completed' && ' · הושלם ✨'}
                  </p>
                </div>
                <span className="text-gray-300 text-2xl">←</span>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
