import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase, readableError } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';

/**
 * Workspace-scoped CRUD for any table in the schema.
 *
 * Reads are filtered by the active scope, and writes always stamp `user_id`
 * and `workspace_id` — the same two columns RLS checks server-side. The client
 * filter is a convenience; the database is what actually enforces isolation.
 *
 *   const { rows, create, update, remove, loading } = useCollection('accounts', {
 *     select: '*, workspace:workspaces(type)',
 *     orderBy: { column: 'name', ascending: true },
 *   });
 */
export function useCollection(table, options = {}) {
  const {
    select = '*',
    orderBy = { column: 'created_at', ascending: false },
    filters = null,
    limit,
    enabled = true,
    scoped = true,
    // Accounts, contacts and categories may be marked "use in both", which is
    // stored as a NULL workspace_id. Those tables opt in here so a shared row
    // shows up in Personal, in Business and in Combined.
    includeShared = false,
  } = options;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { user } = useAuth();
  const { scopeQuery, writeWorkspace, scopeIds } = useWorkspace();
  const toast = useToast();
  const mounted = useRef(true);

  // Serialise the filter object so it can safely drive the effect.
  const filterKey = useMemo(() => JSON.stringify(filters ?? null), [filters]);
  const scopeKey = useMemo(() => scopeIds.join(','), [scopeIds]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchRows = useCallback(async () => {
    if (!user || !enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let query = supabase.from(table).select(select);
      if (scoped) query = scopeQuery(query, 'workspace_id', { includeShared });

      const parsed = filterKey ? JSON.parse(filterKey) : null;
      if (parsed) {
        Object.entries(parsed).forEach(([column, value]) => {
          if (value === undefined || value === null || value === '' || value === 'all') return;
          if (Array.isArray(value)) query = query.in(column, value);
          else if (typeof value === 'object' && value.op) query = query[value.op](column, value.value);
          else query = query.eq(column, value);
        });
      }

      if (orderBy?.column) {
        query = query.order(orderBy.column, { ascending: orderBy.ascending ?? false });
      }
      if (limit) query = query.limit(limit);

      const { data, error: err } = await query;
      if (err) throw err;
      if (mounted.current) setRows(data || []);
    } catch (err) {
      if (mounted.current) {
        setError(readableError(err));
        setRows([]);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
    // orderBy/select are literals at each call site; filterKey + scopeKey carry
    // everything that actually changes at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, select, filterKey, scopeKey, limit, enabled, user, scoped, includeShared, scopeQuery]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  /* ── Mutations ────────────────────────────────────────────────────────── */

  const create = useCallback(
    async (payload, { silent = false } = {}) => {
      if (!user) return { error: 'Not signed in.' };

      // A deliberate null means "shared by both workspaces" and must survive.
      // `||` folded it back to Personal, which quietly un-shared the record.
      const wantsShared =
        includeShared &&
        Object.prototype.hasOwnProperty.call(payload, 'workspace_id') &&
        payload.workspace_id === null;

      const workspaceId = wantsShared ? null : payload.workspace_id || writeWorkspace?.id;

      if (scoped && !wantsShared && !workspaceId) {
        return { error: 'No workspace selected. Choose Personal or Business first.' };
      }

      const record = { ...payload, user_id: user.id };
      if (scoped) record.workspace_id = workspaceId;

      const { data, error: err } = await supabase.from(table).insert(record).select(select).single();

      if (err) {
        const message = readableError(err);
        if (!silent) toast.error(message);
        return { error: message };
      }

      if (mounted.current) setRows((prev) => [data, ...prev]);
      return { data };
    },
    [user, writeWorkspace, table, select, scoped, includeShared, toast],
  );

  const update = useCallback(
    async (id, patch, { silent = false } = {}) => {
      const { data, error: err } = await supabase
        .from(table)
        .update(patch)
        .eq('id', id)
        .select(select)
        .single();

      if (err) {
        const message = readableError(err);
        if (!silent) toast.error(message);
        return { error: message };
      }

      if (mounted.current) setRows((prev) => prev.map((r) => (r.id === id ? data : r)));
      return { data };
    },
    [table, select, toast],
  );

  const remove = useCallback(
    async (id, { silent = false } = {}) => {
      const { error: err } = await supabase.from(table).delete().eq('id', id);

      if (err) {
        const message = readableError(err);
        if (!silent) toast.error(message);
        return { error: message };
      }

      if (mounted.current) setRows((prev) => prev.filter((r) => r.id !== id));
      return {};
    },
    [table, toast],
  );

  return { rows, loading, error, refresh: fetchRows, create, update, remove, setRows };
}

/**
 * Calls a Postgres RPC and re-runs it whenever the scope changes.
 * Used for `dashboard_summary`, `cash_flow_series`, `expense_breakdown`…
 */
export function useRpc(fn, params = {}, { enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { user } = useAuth();
  const mounted = useRef(true);

  const paramKey = useMemo(() => JSON.stringify(params), [params]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!user || !enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const { data: result, error: err } = await supabase.rpc(fn, JSON.parse(paramKey));

    if (!mounted.current) return;
    if (err) {
      setError(readableError(err));
      setData(null);
    } else {
      setData(result);
    }
    setLoading(false);
  }, [fn, paramKey, enabled, user]);

  useEffect(() => {
    run();
  }, [run]);

  return { data, loading, error, refresh: run };
}
