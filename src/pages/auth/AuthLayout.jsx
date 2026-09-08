import { Logo } from '@/components/brand/Logo';
import { WaveViz } from '@/components/brand/WaveViz';
import { BENEFITS } from '@/lib/constants';
import { icon as resolveIcon } from '@/lib/utils';

/**
 * Split auth canvas: the form on the left, the editorial brand panel on the
 * right. The panel collapses away below `lg` so small screens get the form
 * at full width.
 */
export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-screen bg-base lg:grid-cols-[1fr_1.05fr]">
      {/* ── Form side ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col justify-between px-6 py-8 sm:px-10 lg:px-16 lg:py-12">
        <Logo size={42} />

        <div className="mx-auto w-full max-w-sm py-12">
          <h1 className="headline text-[2.5rem] text-ink sm:text-[2.9rem]">{title}</h1>
          {subtitle && <p className="mt-4 text-[14px] leading-relaxed text-ink-dim">{subtitle}</p>}
          <div className="mt-9">{children}</div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-[11.5px] text-ink-muted">
          <span>© {new Date().getFullYear()} Novatrix Digital</span>
          {footer}
        </div>
      </div>

      {/* ── Brand side ────────────────────────────────────────────────────── */}
      <div className="relative hidden overflow-hidden border-l border-hair bg-surface lg:block">
        <div className="absolute inset-0 grid-veil opacity-60" />
        <div className="absolute -right-24 top-1/4 h-[30rem] w-[30rem] lime-orb" />

        <div className="relative flex h-full flex-col justify-between p-14">
          <p className="eyebrow">Finance. Simplified.</p>

          <div className="max-w-lg">
            <h2 className="headline text-[3.6rem] text-ink xl:text-[4.4rem]">
              Your Money.
              <br />
              <span className="text-accent">Under Control.</span>
            </h2>
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-ink-dim">
              Personal and business finances in one intelligent platform — separated where it
              matters, combined when it counts.
            </p>

            <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4">
              {BENEFITS.map(({ icon: iconName, title, sub }) => {
                const Icon = resolveIcon(iconName);
                return (
                  <div key={title}>
                    <span className="icon-tile mb-3 h-9 w-9 border-accent/20 bg-lime/[0.07]">
                      <Icon size={15} className="text-accent" strokeWidth={2} />
                    </span>
                    <p className="text-[13px] font-semibold leading-tight text-ink">{title}</p>
                    <p className="text-[13px] leading-tight text-ink-muted">{sub}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="relative">
            <p className="font-editorial text-[26px] italic leading-tight text-ink-dim">
              Discipline today,
              <br />
              freedom tomorrow.
            </p>
            <div className="pointer-events-none absolute -bottom-6 right-0 h-24 w-2/3 opacity-70">
              <WaveViz seed={2.4} lines={6} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AuthLayout;
