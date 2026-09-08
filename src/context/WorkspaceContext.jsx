import { createContext, useContext, useMemo, useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { SCOPES } from '@/lib/constants';

const WorkspaceContext = createContext(null);
const STORAGE_KEY = 'novatrix.scope';

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
   */
  const scopeQuery = useCallback(
    (query, column = 'workspace_id') => {
      if (!scopeIds.length) {
        // No workspaces resolved yet — match nothing rather than everything.
        return query.in(column, ['00000000-0000-0000-0000-000000000000']);
      }
      if (scopeIds.length === 1) return query.eq(column, scopeIds[0]);
      return query.in(column, scopeIds);
    },
    [scopeIds],
  );

  /** Resolves a workspace id back to its label — used by row badges. */
  const workspaceLabel = useCallback(
    (id) => {
      const ws = workspaces.find((w) => w.id === id);
      if (!ws) return null;
      return ws.type === 'business' ? 'Business' : 'Personal';
    },
    [workspaces],
  );

  const workspaceType = useCallback(
    (id) => workspaces.find((w) => w.id === id)?.type ?? null,
    [workspaces],
  );

  /* Materialise any due recurring rules once per session. */
  useEffect(() => {
    if (!user) return;
    const key = `novatrix.recurring.${user.id}`;
    const today = new Date().toDateString();
    if (window.sessionStorage.getItem(key) === today) return;

    supabase
      .rpc('run_due_recurring')
      .then(() => window.sessionStorage.setItem(key, today))
      .catch(() => {
        /* non-critical: the dashboard still works without it */
      });
  }, [user]);

  const value = useMemo(
    () => ({
      scope,
      setScope,
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
