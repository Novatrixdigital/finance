import { Plus, ArrowRight } from 'lucide-react';
import { PhoneVisual } from '@/components/dashboard/PhoneVisual';
import { useAuth } from '@/context/AuthContext';
import { useModals } from '@/context/ModalContext';
import { greeting } from '@/lib/format';
import { BENEFITS } from '@/lib/constants';
import { icon as resolveIcon } from '@/lib/utils';

/**
 * The editorial opening of the dashboard.
 *
 * Oversized type on the left, the live product visual on the right — the page
 * reads as a product statement before it reads as a tool.
 */
export function HeroSection({ stats, transactions, trend, onViewInsights }) {
  const { displayName } = useAuth();
  const { open } = useModals();

  const firstName = displayName.split(' ')[0];

  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 grid-veil opacity-50" />

      <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] xl:gap-8">
        {/* ── Copy ────────────────────────────────────────────────────────── */}
        <div className="animate-fade-up">
          <p className="text-[14px] text-ink-dim">
            {greeting()}, {firstName} <span className="ml-0.5">👋</span>
          </p>

          <h1 className="headline mt-4 text-[2.2rem] xs:text-[2.6rem] sm:text-[3.2rem] lg:text-[3.5rem] 2xl:text-[3.85rem] text-ink">
            Your Money.
            <br />
            <span className="text-accent">Under Control.</span>
          </h1>

          <p className="mt-5 max-w-md text-[14px] sm:text-[14.5px] leading-relaxed text-ink-dim">
            Manage your personal and business finances in one intelligent platform.
          </p>

          <div className="mt-7 sm:mt-8 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => open('transaction')} className="btn-primary btn-lg w-full sm:w-auto justify-center">
              <Plus size={18} strokeWidth={2.6} />
              Add Transaction
            </button>
            <button type="button" onClick={onViewInsights} className="btn-secondary btn-lg group w-full sm:w-auto justify-center">
              View Insights
              <ArrowRight
                size={16}
                className="transition-transform duration-300 ease-premium group-hover:translate-x-1"
              />
            </button>
          </div>

          {/* Benefit points */}
          <div className="mt-9 sm:mt-11 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
            {BENEFITS.map(({ icon: iconName, title, sub }) => {
              const Icon = resolveIcon(iconName);
              return (
                <div key={title} className="group">
                  <span className="icon-tile mb-3 h-9 w-9 group-hover:border-accent/35 group-hover:bg-lime/[0.07]">
                    <Icon
                      size={15}
                      strokeWidth={2}
                      className="text-ink-muted transition-colors duration-300 group-hover:text-accent"
                    />
                  </span>
                  <p className="text-[13px] font-semibold leading-tight text-ink">{title}</p>
                  <p className="text-[13px] leading-tight text-ink-muted">{sub}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Product visual ──────────────────────────────────────────────── */}
        <div className="animate-fade-in [animation-delay:120ms]">
          {/* The two screens are labelled PERSONAL and BUSINESS, so each is
              fed its own figure. It used to be handed the scope total, which
              meant the Personal screen printed the business balance whenever
              you were in Business or Combined. */}
          <PhoneVisual
            personal={stats.personalBalance}
            business={stats.businessBalance}
            shared={stats.sharedBalance}
            receivables={stats.receivables}
            payables={stats.upcoming}
            growth={stats.netWorthGrowth}
            transactions={transactions}
            trend={trend}
          />
        </div>
      </div>
    </section>
  );
}

export default HeroSection;
