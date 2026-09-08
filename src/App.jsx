import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ToastProvider } from '@/context/ToastContext';
import { WorkspaceProvider } from '@/context/WorkspaceContext';
import { ModalProvider } from '@/context/ModalContext';

import { ProtectedRoute, PublicOnlyRoute } from '@/routes/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { PageLoader } from '@/components/ui';
import { BASE_PATH } from '@/lib/config';
import { ErrorBoundary } from '@/components/ErrorBoundary';

import { Login } from '@/pages/auth/Login';
import { Signup } from '@/pages/auth/Signup';
import { ForgotPassword, ResetPassword, AuthCallback } from '@/pages/auth/PasswordFlows';

/* Module pages are split out of the initial bundle — the dashboard is what
   matters for first paint. */
const Dashboard = lazy(() => import('@/pages/app/Dashboard'));
const Transactions = lazy(() => import('@/pages/app/Transactions'));
const Accounts = lazy(() => import('@/pages/app/Accounts'));
const Payments = lazy(() => import('@/pages/app/Payments'));
const Invoices = lazy(() => import('@/pages/app/Invoices'));
const Budgets = lazy(() => import('@/pages/app/Budgets'));
const Goals = lazy(() => import('@/pages/app/Goals'));
const Reports = lazy(() => import('@/pages/app/Reports'));
const Analytics = lazy(() => import('@/pages/app/Analytics'));
const Contacts = lazy(() => import('@/pages/app/Contacts'));
const Categories = lazy(() => import('@/pages/app/Categories'));
const Recurring = lazy(() => import('@/pages/app/Recurring'));
const Subscriptions = lazy(() => import('@/pages/app/Subscriptions'));
const Reminders = lazy(() => import('@/pages/app/Reminders'));
const Settings = lazy(() => import('@/pages/app/Settings'));
const NotFound = lazy(() => import('@/pages/app/NotFound'));

const APP_ROUTES = [
  { path: 'dashboard', Component: Dashboard },
  { path: 'transactions', Component: Transactions },
  { path: 'accounts', Component: Accounts },
  { path: 'payments', Component: Payments },
  { path: 'invoices', Component: Invoices },
  { path: 'budgets', Component: Budgets },
  { path: 'goals', Component: Goals },
  { path: 'reports', Component: Reports },
  { path: 'analytics', Component: Analytics },
  { path: 'contacts', Component: Contacts },
  { path: 'categories', Component: Categories },
  { path: 'recurring', Component: Recurring },
  { path: 'subscriptions', Component: Subscriptions },
  { path: 'reminders', Component: Reminders },
  { path: 'settings', Component: Settings },
];

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter basename={BASE_PATH === '/' ? undefined : BASE_PATH}>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <WorkspaceProvider>
                <ModalProvider>
                  <Suspense fallback={<PageLoader />}>
                    <Routes>
                      {/* Public */}
                      <Route
                        path="/login"
                        element={
                          <PublicOnlyRoute>
                            <Login />
                          </PublicOnlyRoute>
                        }
                      />
                      <Route
                        path="/signup"
                        element={
                          <PublicOnlyRoute>
                            <Signup />
                          </PublicOnlyRoute>
                        }
                      />
                      <Route
                        path="/forgot-password"
                        element={
                          <PublicOnlyRoute>
                            <ForgotPassword />
                          </PublicOnlyRoute>
                        }
                      />
                      <Route path="/reset" element={<ResetPassword />} />
                      <Route path="/auth/callback" element={<AuthCallback />} />

                      {/* Application */}
                      <Route
                        element={
                          <ProtectedRoute>
                            <AppShell />
                          </ProtectedRoute>
                        }
                      >
                        {APP_ROUTES.map(({ path, Component }) => (
                          <Route key={path} path={`/${path}`} element={<Component />} />
                        ))}
                      </Route>

                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                </ModalProvider>
              </WorkspaceProvider>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
