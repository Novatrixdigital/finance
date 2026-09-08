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

  const ids = useMemo(
    () => (workspaceId ? [workspaceId] : scopeIds),
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

    Promise.all([
      supabase
        .from('accounts')
        .select('id, name, type, current_balance, workspace_id, currency')
        .in('workspace_id', ids)
        .eq('is_active', true)
        .order('is_primary', { ascending: false })
        .order('name'),
      // workspace_id IS NULL means "shared across both workspaces".
      supabase
        .from('categories')
        .select('id, name, kind, icon, color, workspace_id')
        .or(`workspace_id.in.(${ids.join(',')}),workspace_id.is.null`)
        .order('sort_order')
        .order('name'),
      supabase
        .from('contacts')
        .select('id, name, type, company, workspace_id')
        .in('workspace_id', ids)
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
