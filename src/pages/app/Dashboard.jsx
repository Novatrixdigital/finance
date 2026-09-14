import { useRef, useState, useEffect, useCallback } from 'react';
import { Sparkles, Landmark } from 'lucide-react';
import { HeroSection } from '@/components/dashboard/HeroSection';
import { NetWorthCard, QuickActions } from '@/components/dashboard/NetWorthCard';
import { SummaryCards } from '@/components/dashboard/SummaryCards';
import {
  RecentTransactions,
  UpcomingPayments,
  GoalsPanel,
  PromoCard,
  QuoteCard,
} from '@/components/dashboard/Panels';
import { CashFlowChart } from '@/components/charts/CashFlowChart';
import { ExpenseDonut } from '@/components/charts/ExpenseDonut';
import { Card } from '@/components/ui';
import { useDashboard } from '@/hooks/useDashboard';
import { useModals } from '@/context/ModalContext';

/* ── First-run panel: point at the first real record ─────────────────────── */
/*
 * This used to offer "Load demo data", which called seed_demo_data(). That
 * function opened with nine DELETEs across the caller's own rows before
 * writing its sample book, so one press on an account holding real records
 * would have wiped them. Both the button and the function are gone.
 */
function GetStartedCard() {
  const { open } = useModals();

  return (
    <Card className="relative overflow-hidden border-accent/25 bg-lime/[0.04]">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 lime-orb" />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-4">
          <span className="icon-tile h-12 w-12 shrink-0 border-accent/30 bg-accent/10">
            <Sparkles size={19} className="text-accent" strokeWidth={1.9} />
          </span>
          <div>
            <h3 className="text-[16px] font-semibold text-ink">Start with what you have.</h3>
            <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-ink-dim">
              Set the opening balance on your bank account and your cash in hand, then record
              entries as they happen. Every figure on this page is computed from them — nothing
              here is a sample.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-3">
          <button type="button" onClick={() => open('account')} className="btn-primary btn-md">
            <Landmark size={16} />
            Add an account
          </button>
          <button
            type="button"
            onClick={() => open('transaction', { defaultType: 'expense' })}
            className="btn-secondary btn-md"
          >
            Record an entry
          </button>
        </div>
      </div>
    </Card>
  );
}

/**
 * The dashboard.
 *
 * Composition, top to bottom: editorial hero + product visual, the five
 * headline figures, then a Bento grid of analysis panels. Everything reads
 * from the active workspace scope.
 */
export default function Dashboard() {
  const { stats, chart, donut, transactions, payments, goals, loading, isEmpty, refreshAll } =
    useDashboard();
  const { dirtyToken } = useModals();
  const insightsRef = useRef(null);
  const [period, setPeriod] = useState('month');

  /* Any successful form save refreshes the whole dashboard. */
  useEffect(() => {
    if (dirtyToken > 0) refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyToken]);

  const scrollToInsights = useCallback(() => {
    insightsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  /* Net trend feeds the sparkline and the phone chart. */
  const netTrend = chart.map((c) => c.income - c.expense);

  return (
    <div className="mx-auto max-w-[1560px] space-y-8">
      {isEmpty && <GetStartedCard />}

      {/* ── HERO + RIGHT RAIL ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <HeroSection
          stats={stats}
          transactions={transactions}
          trend={netTrend}
          onViewInsights={scrollToInsights}
        />

        <aside className="stagger space-y-5">
          <NetWorthCard stats={stats} trend={netTrend} />
          <QuickActions />
        </aside>
      </div>

      {/* ── SUMMARY FIGURES ───────────────────────────────────────────────── */}
      <SummaryCards stats={stats} />

      {/* ── BENTO GRID ────────────────────────────────────────────────────── */}
      <div ref={insightsRef} className="scroll-mt-24 space-y-6">
        {/*
          Row 1 — charts + recent activity.

          Two across from `md`, not `lg`: a tablet in portrait was stacking
          these full width, so a 900px screen showed one card and a scroll.
        */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          <CashFlowChart data={chart} loading={loading} />
          <ExpenseDonut data={donut} loading={loading} period={period} onPeriodChange={setPeriod} />
          <RecentTransactions rows={transactions} loading={loading} />
        </div>

        {/* Row 2 — obligations */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <UpcomingPayments rows={payments} loading={loading} />
          {/* self-start so the short quote does not stretch into a tall empty
              box beside the payments table — whitespace reads better here. */}
          <div className="self-start">
            <QuoteCard />
          </div>
        </div>

        {/* Row 3 — goals + brand statement */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <GoalsPanel rows={goals} loading={loading} />
          <PromoCard />
        </div>
      </div>
    </div>
  );
}
