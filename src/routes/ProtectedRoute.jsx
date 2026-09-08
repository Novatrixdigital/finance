import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { PageLoader } from '@/components/ui';

/**
 * Gate for everything behind sign-in.
 *
 * While the first session check is in flight we render the brand loader — not
 * a redirect — so a hard refresh never flashes the login screen at a user who
 * is in fact signed in.
 */
export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;

  if (!user) {
    // Remember where they were headed so sign-in can return them there.
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return children;
}

/** Inverse gate: keeps a signed-in user off the auth screens. */
export function PublicOnlyRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;
  if (user) return <Navigate to={location.state?.from || '/dashboard'} replace />;

  return children;
}

export default ProtectedRoute;
