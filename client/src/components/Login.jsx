import { useState } from 'react';
import axios from 'axios';

export default function Login({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
      const body = isRegister
        ? { username, password, displayName }
        : { username, password };

      const { data } = await axios.post(endpoint, body);
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בהתחברות');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-100 via-green-50 to-yellow-50 p-4">
      <div className="bg-white rounded-3xl shadow-xl p-8 w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">✏️📖</div>
          <h1 className="text-3xl font-bold text-buddy-blue">חבר לכתיבה</h1>
          <p className="text-gray-500 mt-2 text-lg">בואו נכתוב יחד!</p>
        </div>

        {/* Toggle */}
        <div className="flex rounded-2xl bg-gray-100 p-1 mb-6">
          <button
            onClick={() => { setIsRegister(false); setError(''); }}
            className={`flex-1 py-2 rounded-xl text-lg font-semibold transition-all ${
              !isRegister ? 'bg-buddy-blue text-white shadow' : 'text-gray-500'
            }`}
          >
            התחברות
          </button>
          <button
            onClick={() => { setIsRegister(true); setError(''); }}
            className={`flex-1 py-2 rounded-xl text-lg font-semibold transition-all ${
              isRegister ? 'bg-buddy-green text-white shadow' : 'text-gray-500'
            }`}
          >
            הרשמה
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <div>
              <label className="block text-gray-700 font-semibold mb-1">השם שלי</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:border-buddy-blue focus:outline-none transition-colors"
                placeholder="איך קוראים לך?"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-gray-700 font-semibold mb-1">שם משתמש</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:border-buddy-blue focus:outline-none transition-colors"
              placeholder="הכניסו שם משתמש"
              required
            />
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-1">סיסמה</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:border-buddy-blue focus:outline-none transition-colors"
              placeholder="הכניסו סיסמה"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 text-center font-semibold">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3 rounded-xl text-white text-xl font-bold shadow-lg transition-all ${
              isRegister
                ? 'bg-buddy-green hover:bg-green-600'
                : 'bg-buddy-blue hover:bg-blue-600'
            } ${loading ? 'opacity-70 cursor-not-allowed' : 'hover:scale-[1.02]'}`}
          >
            {loading ? 'רגע...' : isRegister ? 'הרשמה' : 'התחברות'}
          </button>
        </form>
      </div>
    </div>
  );
}
