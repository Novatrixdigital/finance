import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User, Eye, EyeOff, CheckCircle2, Check } from 'lucide-react';
import { AuthLayout } from '@/pages/auth/AuthLayout';
import { Button, Input } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { cx } from '@/lib/utils';

const RULES = [
  { id: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { id: 'letter', label: 'One letter', test: (p) => /[a-zA-Z]/.test(p) },
  { id: 'number', label: 'One number', test: (p) => /\d/.test(p) },
];

export function Signup() {
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const { signUp } = useAuth();
  const navigate = useNavigate();

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const passed = RULES.filter((r) => r.test(form.password));

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.fullName.trim()) return setError('Tell us your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return setError('Enter a valid email address.');
    if (passed.length < RULES.length) return setError('Choose a stronger password.');

    setBusy(true);
    const { error: err, needsConfirmation } = await signUp(form);
    setBusy(false);

    if (err) return setError(err);

    if (needsConfirmation) {
      setSent(true);
      return;
    }
    navigate('/dashboard', { replace: true });
  };

  if (sent) {
    return (
      <AuthLayout title="Check your inbox." subtitle={`We sent a confirmation link to ${form.email}.`}>
        <div className="rounded-3xl border border-accent/25 bg-lime/[0.06] p-6">
          <CheckCircle2 size={22} className="mb-3 text-accent" />
          <p className="text-[13.5px] leading-relaxed text-ink-dim">
            Click the link in that email to activate your account. Your Personal and Business workspaces
            are already waiting.
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
      title="Start in minutes."
      subtitle="One account. Personal and business books, kept properly apart."
      footer={
        <Link to="/login" className="text-ink-dim transition-colors hover:text-accent">
          I already have an account
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
          label="Full name"
          name="fullName"
          icon={User}
          autoComplete="name"
          value={form.fullName}
          onChange={set('fullName')}
          placeholder="Surendran M"
        />

        <Input
          label="Email"
          name="email"
          type="email"
          icon={Mail}
          autoComplete="email"
          value={form.email}
          onChange={set('email')}
          placeholder="you@company.com"
        />

        <div>
          <label htmlFor="password" className="field-label">
            Password
          </label>
          <div className="relative">
            <Lock size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              id="password"
              name="password"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={form.password}
              onChange={set('password')}
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

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            {RULES.map((rule) => {
              const ok = rule.test(form.password);
              return (
                <span
                  key={rule.id}
                  className={cx(
                    'inline-flex items-center gap-1.5 text-[11.5px] transition-colors',
                    ok ? 'text-accent' : 'text-ink-muted',
                  )}
                >
                  <Check size={12} strokeWidth={ok ? 3 : 2} />
                  {rule.label}
                </span>
              );
            })}
          </div>
        </div>

        <Button type="submit" size="lg" loading={busy} className="w-full">
          Create account
        </Button>

        <p className="text-center text-[11.5px] leading-relaxed text-ink-muted">
          By continuing you agree to keep your financial data accurate and secure.
        </p>
      </form>

      <p className="mt-8 text-center text-[13px] text-ink-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-accent transition-opacity hover:opacity-80">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

export default Signup;
