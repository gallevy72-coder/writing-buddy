import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import WritingSession from './components/WritingSession';
import ProtectedRoute from './components/ProtectedRoute';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });

  const login = (token, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    setToken(token);
    setUser(user);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  return (
    <div className="min-h-screen bg-buddy-bg">
      <Routes>
        <Route
          path="/login"
          element={
            token ? <Navigate to="/" /> : <Login onLogin={login} />
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute token={token}>
              <Dashboard user={user} token={token} onLogout={logout} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/session/:id"
          element={
            <ProtectedRoute token={token}>
              <WritingSession user={user} token={token} onLogout={logout} />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </div>
  );
}
