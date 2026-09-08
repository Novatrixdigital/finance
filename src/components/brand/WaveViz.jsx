import { useMemo } from 'react';
import { cx } from '@/lib/utils';

/**
 * Abstract lime wave field — the decorative financial-data motif used behind
 * the sidebar promo panel and the promotional card.
 *
 * Pure SVG so it scales, costs nothing, and inherits the theme. `seed` shifts
 * the phase so two instances on one screen never look identical.
 */
export function WaveViz({ className, lines = 7, seed = 0, opacity = 0.55 }) {
  const paths = useMemo(() => {
    const out = [];
    for (let i = 0; i < lines; i += 1) {
      const phase = seed + i * 0.55;
      const amp = 12 + i * 1.6;
      const baseline = 60 + i * 5;

      let d = `M 0 ${baseline}`;
      for (let x = 0; x <= 200; x += 10) {
        const y =
          baseline -
          Math.sin(x / 26 + phase) * amp * 0.6 -
          Math.sin(x / 61 + phase * 1.7) * amp * 0.4;
        d += ` L ${x} ${y.toFixed(2)}`;
      }
      out.push({ d, key: i, fade: 1 - i / (lines + 2) });
    }
    return out;
  }, [lines, seed]);

  return (
    <svg
      viewBox="0 0 200 120"
      preserveAspectRatio="none"
      className={cx('h-full w-full', className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`wave-fade-${seed}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#C8FF00" stopOpacity="0.05" />
          <stop offset="45%" stopColor="#C8FF00" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#C8FF00" stopOpacity="0.08" />
        </linearGradient>
      </defs>

      {paths.map(({ d, key, fade }) => (
        <path
          key={key}
          d={d}
          fill="none"
          stroke={`url(#wave-fade-${seed})`}
          strokeWidth={key === 0 ? 1.4 : 0.8}
          opacity={fade * opacity}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

/**
 * Minimal vertical bar sparkline — the net-worth trend indicator.
 * Values are normalised, so any scale of numbers works.
 */
export function BarSpark({ values = [], className, bars = 8, tone = '#C8FF00' }) {
  const data = useMemo(() => {
    const source = values.length ? values : [3, 5, 4, 7, 6, 9, 8, 11];
    const slice = source.slice(-bars);
    const max = Math.max(...slice.map((v) => Math.abs(Number(v) || 0)), 1);
    return slice.map((v) => Math.max((Math.abs(Number(v) || 0) / max) * 100, 8));
  }, [values, bars]);

  return (
    <div className={cx('flex h-10 items-end gap-[3px]', className)} aria-hidden="true">
      {data.map((height, i) => (
        <div
          key={i}
          className="w-[5px] rounded-sm transition-all duration-700 ease-premium"
          style={{
            height: `${height}%`,
            backgroundColor: tone,
            opacity: 0.35 + (i / data.length) * 0.65,
          }}
        />
      ))}
    </div>
  );
}

/** Thin curved guide lines used behind the phone visual. */
export function ArcField({ className }) {
  return (
    <svg viewBox="0 0 400 400" className={cx('h-full w-full', className)} aria-hidden="true">
      <defs>
        <linearGradient id="arc-stroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C8FF00" stopOpacity="0" />
          <stop offset="50%" stopColor="#C8FF00" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#C8FF00" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[130, 165, 200, 235].map((r, i) => (
        <circle
          key={r}
          cx="200"
          cy="200"
          r={r}
          fill="none"
          stroke="url(#arc-stroke)"
          strokeWidth={i === 1 ? 1.2 : 0.7}
          strokeDasharray={i % 2 ? '3 9' : undefined}
        />
      ))}
    </svg>
  );
}

export default WaveViz;
