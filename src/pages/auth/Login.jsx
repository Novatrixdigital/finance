import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { AuthLayout } from '@/pages/auth/AuthLayout';
import { Button, Input } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const { signIn, isConfigured } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setBusy(true);
    const { error: err } = await signIn({ email, password });
    setBusy(false);

    if (err) {
      setError(err);
      return;
    }
    navigate(location.state?.from || '/dashboard', { replace: true });
  };

  return (
    <AuthLayout
      title="Welcome back."
      subtitle="Sign in to pick up exactly where you left off."
      footer={
        <Link to="/signup" className="text-ink-dim transition-colors hover:text-accent">
          Create an account
        </Link>
      }
    >
      {!isConfigured && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/[0.07] p-4">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-[12.5px] leading-relaxed text-ink-dim">
            Supabase is not configured yet. Add <code className="text-accent">VITE_SUPABASE_URL</code> and{' '}
            <code className="text-accent">VITE_SUPABASE_ANON_KEY</code> to <code>.env</code>, then restart the dev
            server.
          </p>
        </div>
      )}

      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && (
          <div className="rounded-2xl border border-negative/30 bg-negative/[0.07] px-4 py-3">
            <p className="text-[13px] text-negative">{error}</p>
          </div>
        )}

        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          icon={Mail}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
        />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="password" className="text-[13px] font-medium text-ink-dim">
              Password
            </label>
            <Link to="/forgot-password" className="text-[12px] text-ink-muted transition-colors hover:text-accent">
              Forgot?
            </Link>
          </div>
          <div className="relative">
            <Lock size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              id="password"
              name="password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="field pl-11 pr-12"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Hide password' : 'Show password'}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-muted transition-colors hover:text-ink-dim"
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <Button type="submit" size="lg" loading={busy} className="w-full">
          Sign in
        </Button>
      </form>

      <p className="mt-8 text-center text-[13px] text-ink-muted">
        New to Novatrix?{' '}
        <Link to="/signup" className="font-medium text-accent transition-opacity hover:opacity-80">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}

export default Login;
