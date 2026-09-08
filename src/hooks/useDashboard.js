import { useMemo } from 'react';
import { useRpc, useCollection } from '@/hooks/useCollection';
import { useWorkspace } from '@/context/WorkspaceContext';
import { startOfMonthISO, toISODate } from '@/lib/format';

/**
 * Everything the dashboard renders, in one hook.
 *
 * The heavy aggregation lives in Postgres (`dashboard_summary`,
 * `cash_flow_series`, `expense_breakdown`) so the browser downloads figures
 * rather than a full ledger.
 */
export function useDashboard() {
  const { scope } = useWorkspace();

  const scopeParam = useMemo(() => ({ p_scope: scope }), [scope]);
  const flowParams = useMemo(() => ({ p_scope: scope, p_months: 6 }), [scope]);
  const breakdownParams = useMemo(
    () => ({ p_scope: scope, p_from: startOfMonthISO(), p_to: toISODate() }),
    [scope],
  );

  const summary = useRpc('dashboard_summary', scopeParam);
  const cashFlow = useRpc('cash_flow_series', flowParams);
  const breakdown = useRpc('expense_breakdown', breakdownParams);

  const transactions = useCollection('transactions', {
    select:
      'id, description, amount, type, txn_date, workspace_id, status, category:categories(name, icon, color), account:accounts!transactions_account_id_fkey(name)',
    orderBy: { column: 'txn_date', ascending: false },
    limit: 6,
  });

  const payments = useCollection('payments', {
    select: 'id, name, amount, due_date, status, direction, workspace_id, contact:contacts(name)',
    filters: useMemo(() => ({ direction: 'outgoing', status: ['upcoming', 'pending', 'overdue'] }), []),
    orderBy: { column: 'due_date', ascending: true },
    limit: 6,
  });

  const goals = useCollection('financial_goals', {
    select: '*',
    filters: useMemo(() => ({ status: ['active', 'achieved'] }), []),
    orderBy: { column: 'created_at', ascending: true },
    limit: 4,
  });

  /* Normalise the summary JSON into plain numbers for the cards. */
  const stats = useMemo(() => {
    const s = summary.data || {};
    const n = (v) => Number(v ?? 0);
    return {
      totalBalance: n(s.total_balance),
      personalBalance: n(s.personal_balance),
      businessBalance: n(s.business_balance),
      netWorth: n(s.net_worth),
      netWorthGrowth: n(s.net_worth_growth),
      income: n(s.income_month),
      incomeGrowth: n(s.income_growth),
      expense: n(s.expense_month),
      expenseGrowth: n(s.expense_growth),
      savings: n(s.savings),
      savingsRate: n(s.savings_rate),
      receivables: n(s.pending_receivables),
      receivableCount: n(s.receivable_count),
      upcoming: n(s.upcoming_payments),
      upcomingCount: n(s.upcoming_count),
    };
  }, [summary.data]);

  const chart = useMemo(
    () =>
      (cashFlow.data || []).map((row) => ({
        month: row.label,
        income: Number(row.income) || 0,
        expense: Number(row.expense) || 0,
        net: Number(row.net) || 0,
      })),
    [cashFlow.data],
  );

  const donut = useMemo(
    () =>
      (breakdown.data || []).map((row) => ({
        id: row.category_id || row.name,
        name: row.name,
        value: Number(row.amount) || 0,
        percentage: Number(row.percentage) || 0,
        color: row.color,
        icon: row.icon,
      })),
    [breakdown.data],
  );

  /** True once every panel has finished its first load. */
  const loading =
    summary.loading || cashFlow.loading || breakdown.loading || transactions.loading;

  /** No accounts and no ledger — show the "load demo data" onboarding. */
  const isEmpty =
    !loading &&
    stats.totalBalance === 0 &&
    chart.every((c) => c.income === 0 && c.expense === 0) &&
    transactions.rows.length === 0;

  const refreshAll = () => {
    summary.refresh();
    cashFlow.refresh();
    breakdown.refresh();
    transactions.refresh();
    payments.refresh();
    goals.refresh();
  };

  return {
    stats,
    chart,
    donut,
    transactions: transactions.rows,
    payments: payments.rows,
    goals: goals.rows,
    loading,
    isEmpty,
    error: summary.error,
    refreshAll,
  };
}

export default useDashboard;
