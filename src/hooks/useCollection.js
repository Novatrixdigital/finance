import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase, readableError } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';

/** One network round trip's worth of rows. PostgREST caps a single response. */
const DEFAULT_PAGE_SIZE = 500;

/**
 * Safety valve for `all: true`. A result larger than this is reported as
 * truncated rather than silently dropping the overflow — which is exactly the
 * failure this paging exists to kill.
 */
const MAX_ROWS = 50000;

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
 *
 * READING MORE THAN ONE WINDOW
 * `limit` returns a single bounded window and nothing else — correct for the
 * dashboard's "latest 6". For anything a user scrolls through or totals up,
 * use one of these instead: a bare `limit` discards the overflow in silence,
 * which on a statement means quietly reporting the wrong number.
 *
 *   pageSize: 200   first window now, `loadMore()` for the rest, plus `hasMore`
 *   all: true       every matching row, paged transparently until exhausted
 *
 * With `all`, `truncated` goes true when the result hits MAX_ROWS, so the page
 * can say so out loud.
 */
export function useCollection(table, options = {}) {
  const {
    select = '*',
    orderBy = { column: 'created_at', ascending: false },
    filters = null,
    limit,
    pageSize,
    all = false,
    enabled = true,
    scoped = true,
    // Accounts, contacts and categories may be marked "use in both", which is
    // stored as a NULL workspace_id. Those tables opt in here so a shared row
    // shows up in Personal, in Business and in Combined.
    includeShared = false,
  } = options;

  const paged = all || Boolean(pageSize);
  const step = Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(null);

  const { user } = useAuth();
  const { scopeQuery, writeWorkspace, scopeIds } = useWorkspace();
  const toast = useToast();
  const mounted = useRef(true);
  /* Stops a slow response from a previous scope or filter landing on top of a
     newer one — the classic out-of-order fetch bug. */
  const runId = useRef(0);

  // Serialise the filter object so it can safely drive the effect.
  const filterKey = useMemo(() => JSON.stringify(filters ?? null), [filters]);
  const scopeKey = useMemo(() => scopeIds.join(','), [scopeIds]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Every read is built here so the first page and later pages cannot drift. */
  const buildQuery = useCallback(() => {
    let query = supabase.from(table).select(select);
    if (scoped) query = scopeQuery(query, 'workspace_id', { includeShared });

    const parsed = filterKey ? JSON.parse(filterKey) : null;
    if (parsed) {
      Object.entries(parsed).forEach(([column, value]) => {
        if (value === undefined || value === null || value === '' || value === 'all') return;
        // A list of {op, value} applies every one of them to the same column,
        // which is how a date range gets both of its bounds server-side.
        if (Array.isArray(value) && value.every((v) => v && typeof v === 'object' && v.op)) {
          value.forEach((v) => {
            query = query[v.op](column, v.value);
          });
        } else if (Array.isArray(value)) query = query.in(column, value);
        else if (typeof value === 'object' && value.op) query = query[value.op](column, value.value);
        else query = query.eq(column, value);
      });
    }

    if (orderBy?.column) {
      query = query.order(orderBy.column, { ascending: orderBy.ascending ?? false });
      // A unique tie-breaker keeps the ordering total. Without it two rows
      // sharing a date can swap places between requests, which duplicates one
      // row across pages and loses another.
      if (orderBy.column !== 'id') query = query.order('id', { ascending: false });
    }
    return query;
    // orderBy/select are literals at each call site; filterKey + scopeKey carry
    // everything that actually changes at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, select, filterKey, scopeKey, scoped, includeShared, scopeQuery]);

  const fetchRows = useCallback(async () => {
    if (!user || !enabled) {
      setLoading(false);
      return;
    }

    const run = ++runId.current;
    setLoading(true);
    setError(null);
    setTruncated(false);

    try {
      if (!paged) {
        let query = buildQuery();
        if (limit) query = query.limit(limit);
        const { data, error: err } = await query;
        if (err) throw err;
        if (mounted.current && run === runId.current) {
          setRows(data || []);
          setHasMore(false);
        }
        return;
      }

      const collected = [];
      let more = false;

      for (;;) {
        const { data, error: err } = await buildQuery().range(
          collected.length,
          collected.length + step - 1,
        );
        if (err) throw err;
        if (run !== runId.current) return; // a newer read superseded this one

        collected.push(...(data || []));
        more = (data?.length || 0) === step;

        if (!all || !more || collected.length >= MAX_ROWS) break;
      }

      if (mounted.current && run === runId.current) {
        setRows(collected);
        setHasMore(more);
        setTruncated(all && more);
      }
    } catch (err) {
      if (mounted.current && run === runId.current) {
        setError(readableError(err));
        setRows([]);
        setHasMore(false);
      }
    } finally {
      if (mounted.current && run === runId.current) setLoading(false);
    }
  }, [buildQuery, limit, enabled, user, paged, all, step]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  /** Appends the next window. No-op unless the caller asked for `pageSize`. */
  const loadMore = useCallback(async () => {
    if (!paged || !hasMore || loadingMore) return;
    const run = runId.current;
    setLoadingMore(true);

    const offset = rows.length;
    const { data, error: err } = await buildQuery().range(offset, offset + step - 1);

    if (!mounted.current || run !== runId.current) return;
    if (err) setError(readableError(err));
    else {
      setRows((prev) => [...prev, ...(data || [])]);
      setHasMore((data?.length || 0) === step);
    }
    setLoadingMore(false);
  }, [paged, hasMore, loadingMore, rows.length, buildQuery, step]);

  /**
   * Pulls every remaining window in one go. Export buttons await this so a CSV
   * covers the whole filtered set rather than whichever pages happen to be on
   * screen. Resolves with the complete list.
   */
  const loadAll = useCallback(async () => {
    if (!paged || !hasMore) return rows;
    const run = runId.current;
    setLoadingMore(true);

    const collected = [...rows];
    try {
      for (;;) {
        const { data, error: err } = await buildQuery().range(
          collected.length,
          collected.length + step - 1,
        );
        if (err) throw err;
        if (run !== runId.current) return collected;

        collected.push(...(data || []));
        if ((data?.length || 0) < step || collected.length >= MAX_ROWS) break;
      }
      if (mounted.current && run === runId.current) {
        setRows(collected);
        setHasMore(false);
      }
    } catch (err) {
      if (mounted.current && run === runId.current) setError(readableError(err));
    } finally {
      if (mounted.current && run === runId.current) setLoadingMore(false);
    }
    return collected;
  }, [paged, hasMore, rows, buildQuery, step]);

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

  return {
    rows,
    loading,
    loadingMore,
    hasMore,
    truncated,
    error,
    refresh: fetchRows,
    loadMore,
    loadAll,
    create,
    update,
    remove,
    setRows,
  };
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
  const runId = useRef(0);

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
    const id = ++runId.current;
    setLoading(true);
    setError(null);

    const { data: result, error: err } = await supabase.rpc(fn, JSON.parse(paramKey));

    if (!mounted.current || id !== runId.current) return;
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
