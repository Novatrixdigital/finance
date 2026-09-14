import { createContext, useContext, useMemo, useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { SCOPES } from '@/lib/constants';

const WorkspaceContext = createContext(null);
const STORAGE_KEY = 'novatrix.scope';
const HIDDEN_KEY = 'novatrix.hideAmounts';

/**
 * The Personal / Business / Combined switch.
 *
 * PERSONAL and BUSINESS resolve to exactly one workspace id, so every query
 * filtered through `scopeQuery` physically cannot return the other side's
 * rows. COMBINED widens the filter to both ids — an aggregation at read time,
 * never a merge of the underlying data.
 */
export function WorkspaceProvider({ children }) {
  const { workspaces, user } = useAuth();

  const [scope, setScopeState] = useState(() => {
    if (typeof window === 'undefined') return SCOPES.COMBINED;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return Object.values(SCOPES).includes(saved) ? saved : SCOPES.COMBINED;
  });

  /* Amounts start hidden — the safe default when a screen might be shared or
     overlooked — but the choice to reveal them sticks, so someone working on
     their own laptop is not re-unhiding the figures on every page load. */
  const [hidden, setHidden] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(HIDDEN_KEY) !== 'false';
    } catch {
      return true;
    }
  });

  const toggleHidden = useCallback(() => {
    setHidden((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(HIDDEN_KEY, String(next));
      } catch {
        /* private mode — it just reverts to hidden next load */
      }
      return next;
    });
  }, []);

  const setScope = useCallback((next) => {
    if (!Object.values(SCOPES).includes(next)) return;
    setScopeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode — the choice just won't persist */
    }
  }, []);

  const personal = useMemo(() => workspaces.find((w) => w.type === 'personal') || null, [workspaces]);
  const business = useMemo(() => workspaces.find((w) => w.type === 'business') || null, [workspaces]);

  /** Workspace ids the current scope is allowed to touch. */
  const scopeIds = useMemo(() => {
    if (scope === SCOPES.PERSONAL) return personal ? [personal.id] : [];
    if (scope === SCOPES.BUSINESS) return business ? [business.id] : [];
    return workspaces.map((w) => w.id);
  }, [scope, personal, business, workspaces]);

  /**
   * The workspace new records are written to. COMBINED has no single home, so
   * writes fall back to Personal and the forms surface a workspace picker.
   */
  const writeWorkspace = useMemo(() => {
    if (scope === SCOPES.BUSINESS) return business;
    if (scope === SCOPES.PERSONAL) return personal;
    return personal || business;
  }, [scope, personal, business]);

  /**
   * Applies the scope filter to a PostgREST query builder.
   *
   *   scopeQuery(supabase.from('transactions').select('*'))
   *
   * RLS already limits rows to this user; this narrows them to the workspace
   * the user is actually looking at.
   *
   * `includeShared` widens the filter to rows with a NULL workspace_id — the
   * "use in both" accounts, contacts and categories. They belong to Personal
   * and Business alike, so every scope has to see them or a shared bank
   * account would vanish the moment you switched sides.
   */
  const scopeQuery = useCallback(
    (query, column = 'workspace_id', { includeShared = false } = {}) => {
      if (!scopeIds.length) {
        // No workspaces resolved yet — match nothing rather than everything.
        // Shared rows still belong to this user, so they stay visible.
        return includeShared
          ? query.is(column, null)
          : query.in(column, ['00000000-0000-0000-0000-000000000000']);
      }
      if (includeShared) {
        return query.or(`${column}.in.(${scopeIds.join(',')}),${column}.is.null`);
      }
      if (scopeIds.length === 1) return query.eq(column, scopeIds[0]);
      return query.in(column, scopeIds);
    },
    [scopeIds],
  );

  /** Resolves a workspace id back to its label — used by row badges. */
  const workspaceLabel = useCallback(
    (id) => {
      // NULL is not "missing" here, it is the shared marker.
      if (id === null || id === undefined) return 'Both';
      const ws = workspaces.find((w) => w.id === id);
      if (!ws) return null;
      return ws.type === 'business' ? 'Business' : 'Personal';
    },
    [workspaces],
  );

  const workspaceType = useCallback(
    (id) => {
      if (id === null || id === undefined) return 'shared';
      return workspaces.find((w) => w.id === id)?.type ?? null;
    },
    [workspaces],
  );

  /* Materialise anything the calendar has made due, once per session.
   *
   * Subscriptions were missing from this: run_due_subscriptions() existed but
   * was only reachable from a button on the Subscriptions page, so a renewal
   * never posted to the ledger unless someone went and pressed it. Recurring
   * rules and reminders are rolled at the same time.
   *
   * supabase.rpc() resolves with { data, error } rather than rejecting, so the
   * old .catch() never fired and the "done for today" marker was written even
   * when the call had failed — leaving the rest of the day with nothing run.
   * The result is inspected instead. */
  useEffect(() => {
    if (!user) return;
    const key = `novatrix.duework.${user.id}`;
    const today = new Date().toDateString();
    if (window.sessionStorage.getItem(key) === today) return;

    let cancelled = false;

    (async () => {
      const results = await Promise.all([
        supabase.rpc('run_due_recurring'),
        supabase.rpc('run_due_subscriptions'),
        supabase.rpc('generate_reminders'),
      ]);

      if (cancelled) return;

      // Only mark the day done if nothing errored, so a transient failure
      // gets another attempt rather than being skipped until tomorrow.
      if (results.every((r) => !r.error)) {
        try {
          window.sessionStorage.setItem(key, today);
        } catch {
          /* private mode — it just runs again next load */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const value = useMemo(
    () => ({
      scope,
      setScope,
      hidden,
      setHidden,
      toggleHidden,
      scopeIds,
      workspaces,
      personal,
      business,
      writeWorkspace,
      scopeQuery,
      workspaceLabel,
      workspaceType,
      isCombined: scope === SCOPES.COMBINED,
      isPersonal: scope === SCOPES.PERSONAL,
      isBusiness: scope === SCOPES.BUSINESS,
      ready: workspaces.length > 0,
    }),
    [
      scope,
      setScope,
      hidden,
      setHidden,
      toggleHidden,
      scopeIds,
      workspaces,
      personal,
      business,
      writeWorkspace,
      scopeQuery,
      workspaceLabel,
      workspaceType,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return ctx;
}
