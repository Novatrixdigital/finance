import { forwardRef, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Search, ChevronRight, Inbox } from 'lucide-react';
import { cx } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   BUTTON
   ══════════════════════════════════════════════════════════════════════════ */

const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

const SIZES = { sm: 'btn-sm', md: 'btn-md', lg: 'btn-lg' };

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, icon: Icon, iconRight, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(VARIANTS[variant] || VARIANTS.primary, SIZES[size], className)}
      {...rest}
    >
      {loading ? (
        <Loader2 size={16} className="animate-spin" />
      ) : (
        Icon && <Icon size={size === 'lg' ? 18 : 16} strokeWidth={2.2} />
      )}
      {children}
      {iconRight && !loading ? iconRight : null}
    </button>
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   BENTO CARD
   ══════════════════════════════════════════════════════════════════════════ */

export function Card({ as: Tag = 'div', className, hover = false, pad = true, children, ...rest }) {
  return (
    <Tag className={cx('bento', pad && 'bento-pad', hover && 'bento-hover', className)} {...rest}>
      {children}
    </Tag>
  );
}

/** Card header with an optional trailing action — used on every panel. */
export function CardHeader({ title, subtitle, action, className }) {
  return (
    <div className={cx('mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0 flex-1">
        <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
        {subtitle && <p className="mt-1 text-[13px] text-ink-muted">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-3">{action}</div>}
    </div>
  );
}

/** The "View All →" affordance repeated across dashboard panels. */
export function ViewAllLink({ onClick, to, children = 'View All' }) {
  const Tag = to ? 'a' : 'button';
  return (
    <Tag
      href={to}
      type={to ? undefined : 'button'}
      onClick={onClick}
      className="group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hair px-3 py-1.5 text-[12px] font-medium text-ink-dim transition-all duration-300 ease-premium hover:border-accent/40 hover:text-accent"
    >
      {children}
      <ChevronRight size={13} className="transition-transform duration-300 group-hover:translate-x-0.5" />
    </Tag>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   BADGE
   ══════════════════════════════════════════════════════════════════════════ */

export function Badge({ children, className, tone, dot = false }) {
  const tones = {
    lime: 'bg-accent/12 text-accent border-accent/30',
    positive: 'bg-accent/12 text-positive border-accent/25',
    negative: 'bg-negative/12 text-negative border-negative/30',
    warning: 'bg-warning/12 text-warning border-warning/30',
    info: 'bg-info/10 text-info border-info/25',
    neutral: 'bg-hair text-ink-dim border-hair',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium',
        tone ? tones[tone] : 'border-hair bg-hair text-ink-dim',
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/**
 * Personal / Business / Both pill.
 *
 * "Both" is its own state, not a missing one: a record with no workspace is
 * shared by the two, and saying so is the whole point of the badge.
 */
export function WorkspaceBadge({ type }) {
  if (!type) return null;

  const key = String(type).toLowerCase();
  const style =
    key === 'business'
      ? 'border-accent/25 bg-accent/10 text-accent'
      : key === 'shared' || key === 'both'
        ? 'border-info/30 bg-info/10 text-info'
        : 'border-hair-strong bg-hair text-ink-dim';

  const label = key === 'business' ? 'Business' : key === 'shared' || key === 'both' ? 'Both' : 'Personal';

  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]',
        style,
      )}
      title={label === 'Both' ? 'Used by Personal and Business' : undefined}
    >
      {label}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   FORM FIELDS
   ══════════════════════════════════════════════════════════════════════════ */

export const Input = forwardRef(function Input(
  { label, hint, error, className, id, icon: Icon, ...rest },
  ref,
) {
  const inputId = id || rest.name;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="field-label">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <Icon
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted"
          />
        )}
        <input
          ref={ref}
          id={inputId}
          className={cx('field', Icon && 'pl-11', error && 'border-negative/50 focus:border-negative/60', className)}
          aria-invalid={Boolean(error)}
          {...rest}
        />
      </div>
      {error ? (
        <p className="mt-1.5 text-[12px] text-negative">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
});

export const Select = forwardRef(function Select({ label, hint, error, className, id, children, ...rest }, ref) {
  const selectId = id || rest.name;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className="field-label">
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        className={cx('field', error && 'border-negative/50', className)}
        aria-invalid={Boolean(error)}
        {...rest}
      >
        {children}
      </select>
      {error ? (
        <p className="mt-1.5 text-[12px] text-negative">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
});

export const Textarea = forwardRef(function Textarea({ label, hint, error, className, id, ...rest }, ref) {
  const areaId = id || rest.name;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={areaId} className="field-label">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={areaId}
        rows={3}
        className={cx('field resize-none', error && 'border-negative/50', className)}
        {...rest}
      />
      {error ? (
        <p className="mt-1.5 text-[12px] text-negative">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
});

/** Segmented control — the type switcher on forms and chart range pickers. */
export function Segmented({ options, value, onChange, className, size = 'md' }) {
  return (
    <div
      className={cx(
        'inline-flex items-center gap-1 rounded-full border border-hair bg-surface p-1',
        className,
      )}
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={cx(
              'rounded-full font-medium transition-all duration-300 ease-premium',
              size === 'sm' ? 'px-3 py-1.5 text-[12px]' : 'px-4 py-2 text-[13px]',
              active
                ? 'bg-lime text-black shadow-[0_6px_20px_-8px_rgba(200,255,0,0.7)]'
                : 'text-ink-dim hover:bg-hair hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MODAL
   ══════════════════════════════════════════════════════════════════════════ */

/** Everything inside a panel that a Tab press can reach. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  const panelRef = useRef(null);
  /* What had focus before the dialog opened, so it can be given back. */
  const restoreRef = useRef(null);

  const handleKey = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        onClose?.();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;

      /*
        Trap Tab inside the panel.

        Without this, tabbing past the last field walked out of the dialog and
        into the page behind it — which is still scrolled, still interactive
        and, to a screen-reader user, indistinguishable from the dialog. The
        modal looked closed while the form was still open underneath.
      */
      const items = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (!items.length) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement;
    document.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the first control so keyboard users land inside the dialog.
    const timer = setTimeout(() => {
      panelRef.current
        ?.querySelector('input, select, textarea, button:not([aria-label="Close"])')
        ?.focus();
    }, 60);

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      clearTimeout(timer);
      // Hand focus back to whatever opened the dialog; landing on <body>
      // instead means the next Tab restarts from the top of the page.
      const restore = restoreRef.current;
      if (restore && typeof restore.focus === 'function' && document.contains(restore)) {
        restore.focus();
      }
    };
  }, [open, handleKey]);

  if (!open) return null;

  const widths = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-[var(--c-scrim)] backdrop-blur-md"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'relative z-10 flex max-h-[90vh] sm:max-h-[88vh] w-full animate-scale-in flex-col overflow-hidden rounded-t-3xl border border-hair bg-card shadow-lift sm:rounded-3xl',
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-hair px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold tracking-[-0.01em] text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 sm:mt-1 text-[12px] sm:text-[13px] text-ink-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-xl border border-hair p-1.5 sm:p-2 text-ink-dim transition-all duration-300 hover:border-hair-strong hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-hair bg-surface/60 px-4 py-3 sm:px-6 sm:py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   STATES
   ══════════════════════════════════════════════════════════════════════════ */

export function EmptyState({ icon: Icon = Inbox, title, description, action, compact = false }) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-hair text-center',
        compact ? 'gap-3 px-6 py-10' : 'gap-4 px-8 py-16',
      )}
    >
      <div className="icon-tile h-14 w-14 border-hair bg-surface">
        <Icon size={22} className="text-ink-muted" strokeWidth={1.6} />
      </div>
      <div className="max-w-sm">
        <p className="text-[15px] font-semibold text-ink">{title}</p>
        {description && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cx('skeleton', className)} />;
}

export function LoadingBlock({ rows = 3, className }) {
  return (
    <div className={cx('space-y-3', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-11 w-11 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

export function Spinner({ size = 18, className }) {
  return <Loader2 size={size} className={cx('animate-spin text-accent', className)} />;
}

/** Full-screen brand loader used while the session resolves. */
export function PageLoader({ label = 'Loading your workspace' }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-base">
      <div className="relative">
        <div className="absolute -inset-8 lime-orb animate-pulse-glow" />
        <svg viewBox="0 0 64 64" className="relative h-12 w-12" aria-hidden="true">
          <path d="M18 46V18h6.4l15.2 19.1V18H46v28h-6.4L24.4 26.9V46H18Z" fill="#C8FF00" />
        </svg>
      </div>
      <p className="text-[13px] tracking-[0.08em] text-ink-muted">{label}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MISC
   ══════════════════════════════════════════════════════════════════════════ */

export function SearchInput({ value, onChange, placeholder = 'Search…', className }) {
  return (
    <div className={cx('relative', className)}>
      <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="field pl-11"
      />
    </div>
  );
}

/** Thin lime progress bar used by goals and budgets. */
export function ProgressBar({ value = 0, tone = 'lime', className, height = 'h-1.5' }) {
  const tones = {
    lime: 'bg-lime',
    warning: 'bg-warning',
    negative: 'bg-negative',
    info: 'bg-info',
  };
  return (
    <div className={cx('w-full overflow-hidden rounded-full bg-hair', height, className)}>
      <div
        className={cx('h-full rounded-full transition-all duration-700 ease-premium', tones[tone] || tones.lime)}
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      />
    </div>
  );
}

/** Avatar with initials fallback. */
export function Avatar({ name = '', src, size = 40, className }) {
  const letters = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        style={{ width: size, height: size }}
        className={cx('shrink-0 rounded-xl border border-hair object-cover', className)}
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.34 }}
      className={cx(
        'flex shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/12 font-bold tracking-tight text-accent',
        className,
      )}
    >
      {letters || 'NV'}
    </div>
  );
}

/** Confirmation dialog for destructive actions. */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Delete', loading }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-dim">{message}</p>
    </Modal>
  );
}
