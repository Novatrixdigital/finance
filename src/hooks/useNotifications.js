import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { daysUntil, formatDateShort } from '@/lib/format';

/**
 * There is no notifications table — alerts are derived from the state of the
 * books: overdue invoices, payments falling due this week, and budgets past
 * their alert threshold. That keeps them always accurate and costs no writes.
 */
export function useNotifications() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { scopeQuery, scope } = useWorkspace();

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [invoices, payments, budgets] = await Promise.all([
        scopeQuery(
          supabase
            .from('invoices')
            .select('id, invoice_number, balance_due, due_date, status, contact:contacts(name)')
            .in('status', ['overdue', 'sent', 'partial'])
            .order('due_date', { ascending: true })
            .limit(8),
        ),
        scopeQuery(
          supabase
            .from('payments')
            .select('id, name, amount, due_date, status')
            .in('status', ['upcoming', 'pending', 'overdue'])
            .order('due_date', { ascending: true })
            .limit(8),
        ),
        supabase.rpc('budget_progress', { p_scope: scope }),
      ]);

      const alerts = [];

      (invoices.data || []).forEach((inv) => {
        const days = daysUntil(inv.due_date);
        if (days < 0) {
          alerts.push({
            id: `inv-${inv.id}`,
            kind: 'overdue',
            tone: 'negative',
            title: `${inv.invoice_number} is overdue`,
            detail: `${inv.contact?.name || 'Customer'} · ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} late`,
            amount: inv.balance_due,
            to: '/invoices',
          });
        }
      });

      (payments.data || []).forEach((p) => {
        const days = daysUntil(p.due_date);
        if (days < 0) {
          alerts.push({
            id: `pay-${p.id}`,
            kind: 'overdue',
            tone: 'negative',
            title: `${p.name} is overdue`,
            detail: `Was due ${formatDateShort(p.due_date)}`,
            amount: p.amount,
            to: '/payments',
          });
        } else if (days <= 7) {
          alerts.push({
            id: `pay-${p.id}`,
            kind: 'due',
            tone: 'warning',
            title: `${p.name} due soon`,
            detail: days === 0 ? 'Due today' : `In ${days} day${days === 1 ? '' : 's'}`,
            amount: p.amount,
            to: '/payments',
          });
        }
      });

      (budgets.data || []).forEach((b) => {
        const pct = Number(b.percentage) || 0;
        if (pct >= (b.alert_threshold ?? 80)) {
          alerts.push({
            id: `bud-${b.id}`,
            kind: 'budget',
            tone: pct >= 100 ? 'negative' : 'warning',
            title: pct >= 100 ? `${b.name} budget exceeded` : `${b.name} at ${pct}%`,
            detail: `${b.category_name} · ${b.period}`,
            amount: b.spent,
            to: '/budgets',
          });
        }
      });

      // Most urgent first: overdue, then due soon, then budget warnings.
      const rank = { overdue: 0, due: 1, budget: 2 };
      alerts.sort((a, b) => rank[a.kind] - rank[b.kind]);

      setItems(alerts.slice(0, 12));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user, scopeQuery, scope]);

  useEffect(() => {
    load();
  }, [load]);

  return { items, count: items.length, loading, refresh: load };
}

export default useNotifications;
