import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { CheckCircle2, AlertTriangle, Info, X, XCircle } from 'lucide-react';
import { cx } from '@/lib/utils';

const ToastContext = createContext(null);

const TONES = {
  success: { Icon: CheckCircle2, ring: 'border-accent/30', tint: 'text-accent' },
  error: { Icon: XCircle, ring: 'border-negative/35', tint: 'text-negative' },
  warning: { Icon: AlertTriangle, ring: 'border-warning/35', tint: 'text-warning' },
  info: { Icon: Info, ring: 'border-hair-strong', tint: 'text-ink-dim' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message, tone = 'info', duration = 4200) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((list) => [...list.slice(-3), { id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
      return id;
    },
    [dismiss],
  );

  // Clear every pending timer if the provider unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const value = useMemo(
    () => ({
      toast: push,
      success: (m, d) => push(m, 'success', d),
      error: (m, d) => push(m, 'error', d ?? 6000),
      warning: (m, d) => push(m, 'warning', d),
      info: (m, d) => push(m, 'info', d),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        className="pointer-events-none fixed bottom-6 right-6 z-[100] flex w-[min(24rem,calc(100vw-3rem))] flex-col gap-3"
        role="region"
        aria-live="polite"
        aria-label="Notifications"
      >
        {toasts.map(({ id, message, tone }) => {
          const { Icon, ring, tint } = TONES[tone] || TONES.info;
          return (
            <div
              key={id}
              className={cx(
                'pointer-events-auto flex animate-scale-in items-start gap-3 rounded-2xl border bg-raised/95 p-4 shadow-lift backdrop-blur-xl',
                ring,
              )}
            >
              <Icon size={18} className={cx('mt-0.5 shrink-0', tint)} strokeWidth={2} />
              <p className="flex-1 text-sm leading-relaxed text-ink">{message}</p>
              <button
                type="button"
                onClick={() => dismiss(id)}
                className="shrink-0 rounded-lg p-1 text-ink-muted transition-colors hover:bg-hair hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
