import { useRef, useState, useEffect, useCallback } from 'react';
import { Sparkles, Loader2, DatabaseZap } from 'lucide-react';
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
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { supabase, readableError } from '@/lib/supabase';

/* ── First-run panel: offer a realistic book to explore ──────────────────── */
function OnboardingCard({ onSeeded }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { open } = useModals();

  const seed = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('seed_demo_data');
    setBusy(false);

    if (error) {
      toast.error(readableError(error));
      return;
    }
    if (data && data.ok === false) {
      toast.error(data.error || 'Could not load the demo data.');
      return;
    }
    toast.success('Demo book loaded — six months of transactions, invoices and goals.');
    onSeeded();
  };

  return (
    <Card className="relative overflow-hidden border-accent/25 bg-lime/[0.04]">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 lime-orb" />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-4">
          <span className="icon-tile h-12 w-12 shrink-0 border-accent/30 bg-accent/10">
            <Sparkles size={19} className="text-accent" strokeWidth={1.9} />
          </span>
          <div>
            <h3 className="text-[16px] font-semibold text-ink">Your books are empty.</h3>
            <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-ink-dim">
              Load a realistic six-month demo — accounts, a full ledger, invoices, budgets and goals
              across both workspaces — or start entering your own records straight away.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-3">
          <button type="button" onClick={seed} disabled={busy} className="btn-primary btn-md">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <DatabaseZap size={16} />}
            Load demo data
          </button>
          <button type="button" onClick={() => open('account')} className="btn-secondary btn-md">
            Add an account
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
  const { refresh: refreshAuth } = useAuth();
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

  const afterSeed = useCallback(() => {
    refreshAuth();
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Net trend feeds the sparkline and the phone chart. */
  const netTrend = chart.map((c) => c.income - c.expense);

  return (
    <div className="mx-auto max-w-[1560px] space-y-8">
      {isEmpty && <OnboardingCard onSeeded={afterSeed} />}

      {/* ── HERO + RIGHT RAIL ─────────────────────────────────────────────
          On wide screens the net worth card and quick actions sit beside the
          hero as a true right rail; below xl they stack underneath. */}
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_20rem]">
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
        {/* Row 1 — charts + recent activity */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_20rem]">
          <CashFlowChart data={chart} loading={loading} />
          <ExpenseDonut data={donut} loading={loading} period={period} onPeriodChange={setPeriod} />
          <RecentTransactions rows={transactions} loading={loading} />
        </div>

        {/* Row 2 — obligations */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_20rem]">
          <UpcomingPayments rows={payments} loading={loading} />
          {/* self-start so the short quote does not stretch into a tall empty
              box beside the payments table — whitespace reads better here. */}
          <div className="self-start">
            <QuoteCard />
          </div>
        </div>

        {/* Row 3 — goals + brand statement */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <GoalsPanel rows={goals} loading={loading} />
          <PromoCard />
        </div>
      </div>
    </div>
  );
}
