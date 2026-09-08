import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase, readableError, isSupabaseConfigured } from '@/lib/supabase';
import { AUTH_REDIRECTS } from '@/lib/config';

const AuthContext = createContext(null);

/**
 * Owns the Supabase session, the profile row and the user's workspaces.
 *
 * `loading` stays true until the very first session check resolves, which is
 * what keeps ProtectedRoute from flashing the login screen on a hard refresh.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const user = session?.user ?? null;

  const loadAccountData = useCallback(async (uid) => {
    if (!uid) {
      setProfile(null);
      setWorkspaces([]);
      return;
    }

    const [profileRes, workspaceRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('workspaces').select('*').eq('user_id', uid).order('type', { ascending: true }),
    ]);

    if (!mounted.current) return;

    if (profileRes.data) {
      setProfile(profileRes.data);
    } else if (!profileRes.error) {
      // The signup trigger normally creates this. If it is missing (e.g. the
      // user existed before the trigger was installed), self-heal.
      const { data: created } = await supabase
        .from('profiles')
        .insert({ id: uid, email: '', full_name: '' })
        .select()
        .maybeSingle();
      if (mounted.current && created) setProfile(created);
    }

    if (workspaceRes.data) setWorkspaces(workspaceRes.data);
  }, []);

  useEffect(() => {
    mounted.current = true;

    if (!isSupabaseConfigured) {
      setLoading(false);
      return () => {
        mounted.current = false;
      };
    }

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!mounted.current) return;
        setSession(data.session ?? null);
        if (data.session?.user) await loadAccountData(data.session.user.id);
      })
      .finally(() => mounted.current && setLoading(false));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted.current) return;
      setSession(nextSession ?? null);

      if (event === 'SIGNED_OUT') {
        setProfile(null);
        setWorkspaces([]);
        return;
      }
      // Supabase warns against calling the client from inside this callback:
      // it runs before the session is fully persisted, so the request goes out
      // as `anon` and PostgREST answers 401. Deferring a tick fixes it.
      if (nextSession?.user && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
        setTimeout(() => {
          if (mounted.current) loadAccountData(nextSession.user.id);
        }, 0);
      }
    });

    return () => {
      mounted.current = false;
      subscription?.unsubscribe();
    };
  }, [loadAccountData]);

  /* ── Actions ──────────────────────────────────────────────────────────── */

  const signUp = useCallback(async ({ email, password, fullName }) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName?.trim() || '' },
        emailRedirectTo: AUTH_REDIRECTS.callback(),
      },
    });
    if (error) return { error: readableError(error) };

    // With email confirmation on, there is no session yet.
    const needsConfirmation = !data.session;
    if (data.session?.user) await loadAccountData(data.session.user.id);
    return { needsConfirmation };
  }, [loadAccountData]);

  const signIn = useCallback(async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) return { error: readableError(error) };
    // onAuthStateChange('SIGNED_IN') loads the profile. Doing it here too
    // raced that listener, and whichever call fired before the client had
    // persisted the session came back 401 from PostgREST.
    return {};
  }, []);

  const signInWithProvider = useCallback(async (provider) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: AUTH_REDIRECTS.callback() },
    });
    if (error) return { error: readableError(error) };
    return {};
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setWorkspaces([]);
  }, []);

  const resetPassword = useCallback(async (email) => {
    // Must match the <Route path="/reset"> in App.jsx — an emailed link that
    // lands anywhere else drops the user on the 404 page.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: AUTH_REDIRECTS.reset(),
    });
    if (error) return { error: readableError(error) };
    return {};
  }, []);

  const updatePassword = useCallback(async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: readableError(error) };
    return {};
  }, []);

  const updateProfile = useCallback(
    async (patch) => {
      if (!user) return { error: 'Not signed in.' };
      const { data, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', user.id)
        .select()
        .maybeSingle();
      if (error) return { error: readableError(error) };
      if (data) setProfile(data);
      return { data };
    },
    [user],
  );

  const refresh = useCallback(async () => {
    if (user) await loadAccountData(user.id);
  }, [user, loadAccountData]);

  const value = useMemo(
    () => ({
      session,
      user,
      profile,
      workspaces,
      loading,
      isConfigured: isSupabaseConfigured,
      displayName: profile?.full_name || user?.email?.split('@')[0] || 'there',
      signUp,
      signIn,
      signInWithProvider,
      signOut,
      resetPassword,
      updatePassword,
      updateProfile,
      refresh,
    }),
    [
      session,
      user,
      profile,
      workspaces,
      loading,
      signUp,
      signIn,
      signInWithProvider,
      signOut,
      resetPassword,
      updatePassword,
      updateProfile,
      refresh,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
