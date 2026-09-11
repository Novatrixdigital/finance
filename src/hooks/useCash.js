import { useMemo } from 'react';
import { useRpc, useCollection } from '@/hooks/useCollection';
import { useWorkspace } from '@/context/WorkspaceContext';

/**
 * Everything the Cash page needs.
 *
 * Cash is not a parallel system — it is an ordinary account of type 'cash',
 * which is what makes "noted in both" fall out for free: an entry booked
 * against it lowers cash in hand through the balance trigger AND counts in
 * the month's spend like any other expense. A bank withdrawal is a transfer,
 * so both sides move in one write.
 *
 * `cash_summary` and `cash_activity` do the aggregation in Postgres, and
 * `cash_activity` deliberately also returns entries marked "paid by cash"
 * that were booked against a bank or card — the historical spends that never
 * reduced cash in hand. They come back with `on_cash_account: false` so the
 * page can show them without pretending the balance moved.
 */
export function useCash({ from = null, to = null, limit = 200 } = {}) {
  const { scope } = useWorkspace();

  const summaryParams = useMemo(() => ({ p_scope: scope }), [scope]);
  const activityParams = useMemo(
    () => ({ p_scope: scope, p_from: from, p_to: to, p_limit: limit }),
    [scope, from, to, limit],
  );

  const summary = useRpc('cash_summary', summaryParams);
  const activity = useRpc('cash_activity', activityParams);

  /* The cash accounts themselves — one card each, and the source/target of a
     withdrawal. Read straight from the table so a balance edit shows up
     without waiting on the summary RPC. */
  const accounts = useCollection('accounts', {
    select: 'id, name, type, current_balance, currency, workspace_id, is_active, icon, color',
    filters: useMemo(() => ({ type: 'cash', is_active: true }), []),
    orderBy: { column: 'name', ascending: true },
    // A cash tin marked "use in both" belongs on this page from either side.
    includeShared: true,
  });

  /* Every non-cash account is a possible other side of a withdrawal. */
  const funding = useCollection('accounts', {
    select: 'id, name, type, current_balance, currency, workspace_id',
    filters: useMemo(() => ({ is_active: true }), []),
    orderBy: { column: 'name', ascending: true },
    includeShared: true,
  });

  const stats = useMemo(() => {
    const s = summary.data || {};
    const n = (v) => Number(v ?? 0);
    return {
      inHand: n(s.cash_in_hand),
      accounts: n(s.cash_accounts),
      spentMonth: n(s.spent_month),
      spentTotal: n(s.spent_total),
      receivedMonth: n(s.received_month),
      lastMovement: s.last_movement || null,
      // Spends recorded as cash but booked elsewhere. Reported, never
      // rewritten — the ledger stays exactly as it was entered.
      untrackedAmount: n(s.untracked_amount),
      untrackedCount: n(s.untracked_count),
    };
  }, [summary.data]);

  const rows = useMemo(() => activity.data || [], [activity.data]);

  const bankAccounts = useMemo(
    () => (funding.rows || []).filter((a) => a.type !== 'cash'),
    [funding.rows],
  );

  const refreshAll = () => {
    summary.refresh();
    activity.refresh();
    accounts.refresh();
    funding.refresh();
  };

  return {
    stats,
    rows,
    cashAccounts: accounts.rows,
    bankAccounts,
    loading: summary.loading || activity.loading || accounts.loading,
    error: summary.error || activity.error,
    refreshAll,
  };
}

export default useCash;
