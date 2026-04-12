import { Navigate } from 'react-router-dom';

export default function ProtectedRoute({ token, children }) {
  if (!token) {
    return <Navigate to="/login" />;
  }
  return children;
}
