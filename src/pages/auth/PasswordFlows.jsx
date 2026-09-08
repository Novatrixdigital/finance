import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, MailCheck } from 'lucide-react';
import { AuthLayout } from '@/pages/auth/AuthLayout';
import { Button, Input, PageLoader } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';

/* ══════════════════════════════════════════════════════════════════════════
   FORGOT PASSWORD
   ══════════════════════════════════════════════════════════════════════════ */
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const { resetPassword } = useAuth();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Enter a valid email address.');

    setBusy(true);
    const { error: err } = await resetPassword(email);
    setBusy(false);

    if (err) return setError(err);
    setSent(true);
  };

  if (sent) {
    return (
      <AuthLayout title="Link sent." subtitle={`If ${email} has an account, a reset link is on its way.`}>
        <div className="rounded-3xl border border-accent/25 bg-lime/[0.06] p-6">
          <MailCheck size={22} className="mb-3 text-accent" />
          <p className="text-[13.5px] leading-relaxed text-ink-dim">
            The link expires in one hour. Check your spam folder if it does not arrive shortly.
          </p>
        </div>
        <Link to="/login" className="btn-secondary btn-md mt-6 w-full">
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset password."
      subtitle="We will email you a secure link to choose a new one."
      footer={
        <Link to="/login" className="text-ink-dim transition-colors hover:text-accent">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && (
          <div className="rounded-2xl border border-negative/30 bg-negative/[0.07] px-4 py-3">
            <p className="text-[13px] text-negative">{error}</p>
          </div>
        )}
        <Input
          label="Email"
          type="email"
          icon={Mail}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
        <Button type="submit" size="lg" loading={busy} className="w-full">
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SET NEW PASSWORD  (landed on from the emailed link)
   ══════════════════════════════════════════════════════════════════════════ */
export function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { updatePassword } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');

    setBusy(true);
    const { error: err } = await updatePassword(password);
    setBusy(false);

    if (err) return setError(err);
    toast.success('Password updated. You are signed in.');
    navigate('/dashboard', { replace: true });
  };

  return (
    <AuthLayout title="Choose a new password." subtitle="Make it something only you would guess.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && (
          <div className="rounded-2xl border border-negative/30 bg-negative/[0.07] px-4 py-3">
            <p className="text-[13px] text-negative">{error}</p>
          </div>
        )}
        <Input
          label="New password"
          type="password"
          icon={Lock}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
        <Input
          label="Confirm password"
          type="password"
          icon={Lock}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
        />
        <Button type="submit" size="lg" loading={busy} className="w-full">
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   OAUTH / EMAIL CONFIRMATION CALLBACK
   ══════════════════════════════════════════════════════════════════════════ */
export function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;

    // detectSessionInUrl exchanges the code; this just waits for the result.
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      navigate(data.session ? '/dashboard' : '/login', { replace: true });
    });

    return () => {
      alive = false;
    };
  }, [navigate]);

  return <PageLoader label="Completing sign in" />;
}
