import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';

/**
 * Loads the select-list data every record form needs: accounts, categories
 * and contacts, all scoped to the workspace the record will be written to.
 *
 * Pass `workspaceId` to pin the lists to a specific workspace — that is what
 * keeps a Business transaction from offering a Personal account.
 */
export function useFormOptions(workspaceId) {
  const { user } = useAuth();
  const { scopeIds } = useWorkspace();

  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Forms carry `__shared__` in the picker to mean "both workspaces", and a
  // couple of them seed workspace_id before it resolves. Neither is a usable
  // filter value — PostgREST would reject the malformed uuid — so anything
  // that is not a real id falls back to the active scope.
  const isRealId = (v) =>
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  const ids = useMemo(
    () => (isRealId(workspaceId) ? [workspaceId] : scopeIds),
    [workspaceId, scopeIds],
  );
  const idKey = useMemo(() => ids.join(','), [ids]);

  useEffect(() => {
    let alive = true;
    if (!user || !ids.length) {
      setLoading(false);
      return () => {
        alive = false;
      };
    }

    setLoading(true);

    // workspace_id IS NULL means "use in both", so accounts, categories and
    // contacts all widen the filter the same way. Without this, a bank account
    // marked Both would disappear from the picker as soon as you were writing
    // a Business transaction — which is precisely what sharing is for.
    const orShared = `workspace_id.in.(${ids.join(',')}),workspace_id.is.null`;

    Promise.all([
      supabase
        .from('accounts')
        .select('id, name, type, current_balance, workspace_id, currency')
        .or(orShared)
        .eq('is_active', true)
        .order('is_primary', { ascending: false })
        .order('name'),
      supabase
        .from('categories')
        .select('id, name, kind, icon, color, workspace_id')
        .or(orShared)
        .order('sort_order')
        .order('name'),
      supabase
        .from('contacts')
        .select('id, name, type, company, workspace_id')
        .or(orShared)
        .eq('is_active', true)
        .order('name'),
    ])
      .then(([acc, cat, con]) => {
        if (!alive) return;
        setAccounts(acc.data || []);
        setCategories(cat.data || []);
        setContacts(con.data || []);
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, idKey]);

  const categoriesByKind = useMemo(
    () => ({
      income: categories.filter((c) => c.kind === 'income'),
      expense: categories.filter((c) => c.kind === 'expense'),
      transfer: categories.filter((c) => c.kind === 'transfer'),
    }),
    [categories],
  );

  return { accounts, categories, categoriesByKind, contacts, loading };
}

export default useFormOptions;
