import { cx } from '@/lib/utils';

/**
 * The Novatrix mark.
 *
 * An abstract N cut from a single diagonal, with a detached node at the top
 * right reading as an upward data point. Deliberately simple so it survives
 * being rendered at 20px in the sidebar.
 */
export function LogoMark({ size = 40, className, glow = false }) {
  return (
    <div className={cx('relative shrink-0', className)} style={{ width: size, height: size }}>
      {glow && <div className="absolute -inset-2 lime-orb opacity-70" aria-hidden="true" />}
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        className="relative"
        role="img"
        aria-label="Novatrix Digital"
      >
        <rect width="64" height="64" rx="16" className="fill-elevated" />
        <rect
          x="0.75"
          y="0.75"
          width="62.5"
          height="62.5"
          rx="15.25"
          fill="none"
          stroke="rgba(200,255,0,0.28)"
          strokeWidth="1.5"
        />
        {/* N — left stem, diagonal, right stem */}
        <path d="M18 46V18h6.4l15.2 19.1V18H46v28h-6.4L24.4 26.9V46H18Z" fill="#C8FF00" />
        {/* Detached node: the "growth" point */}
        <circle cx="45.5" cy="19.5" r="3.4" fill="#C8FF00" opacity="0.55" />
      </svg>
    </div>
  );
}

/** Mark plus wordmark and tagline — the sidebar and auth-screen lockup. */
export function Logo({ size = 40, compact = false, className, showTagline = true }) {
  return (
    <div className={cx('flex items-center gap-3', className)}>
      <LogoMark size={size} />
      {!compact && (
        <div className="min-w-0 leading-none">
          <p className="truncate text-[15px] font-bold tracking-[-0.02em] text-ink">Novatrix Digital</p>
          {showTagline && (
            <p className="mt-1 truncate text-[11px] tracking-[0.02em] text-ink-muted">Finance. Simplified.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default Logo;
