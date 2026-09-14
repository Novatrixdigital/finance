import { createClient } from '@supabase/supabase-js';

/**
 * Supabase browser client.
 *
 * Only the anon (publishable) key ever reaches the bundle. Every table is
 * protected by Row Level Security, so this key can read nothing without a
 * valid session. The service_role key must never appear anywhere in /src.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True when the project has real credentials wired up. */
export const isSupabaseConfigured = Boolean(
  url && anonKey && !url.includes('your-project-ref') && !anonKey.includes('your-anon'),
);

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.warn(
    '[Novatrix] Supabase is not configured. Copy .env.example to .env and add\n' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server.',
  );
}

export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'public-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'novatrix.auth',
    flowType: 'pkce',
  },
  global: {
    headers: { 'x-application-name': 'novatrix-digital' },
  },
  db: { schema: 'public' },
});

/**
 * Normalises a Supabase/PostgREST error into something a human can read.
 * Postgres constraint noise is translated; anything unknown falls through.
 */
export function readableError(error) {
  if (!error) return null;
  const message = error.message || String(error);

  const map = [
    [/duplicate key value.*invoices_number_unique/i, 'That invoice number already exists.'],
    [/duplicate key value.*workspaces_user_type_unique/i, 'That workspace already exists.'],
    [/duplicate key value/i, 'A record with these details already exists.'],
    [/violates row-level security/i, 'You do not have permission to change this record.'],
    [/transactions_transfer_target/i, 'A transfer needs a destination account different from the source.'],
    [/violates foreign key/i, 'A linked record is missing or was deleted.'],
    [/violates check constraint/i, 'One of the values is out of range.'],
    [/Invalid login credentials/i, 'That email and password combination is not correct.'],
    [/Email not confirmed/i, 'Please confirm your email address first — check your inbox.'],
    [/User already registered/i, 'An account with this email already exists. Try signing in.'],
    [/Password should be at least/i, 'Password must be at least 6 characters.'],
    [/rate limit|too many requests/i, 'Too many attempts. Please wait a moment and try again.'],
    [/Failed to fetch|NetworkError/i, 'Cannot reach the server. Check your connection.'],
  ];

  for (const [pattern, friendly] of map) {
    if (pattern.test(message)) return friendly;
  }
  return message;
}

/** Uploads a file to a uid-scoped folder. Path contract: `<uid>/<name>`. */
export async function uploadFile(bucket, userId, file, prefix = '') {
  const ext = file.name.split('.').pop();
  const safe = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `${userId}/${safe}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;

  if (bucket === 'avatars') {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return { path, url: data.publicUrl };
  }

  const { data, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (signErr) throw signErr;
  return { path, url: data.signedUrl };
}

/**
 * A fresh signed link for a private object.
 *
 * Private buckets can only be read through a signed URL, and those expire.
 * Persisting the one `uploadFile` hands back would have worked for a week and
 * then quietly turned every receipt link into a 400, so what gets stored on the
 * row is the *path* and the link is minted when someone actually asks for it.
 */
export async function signedUrl(bucket, path, seconds = 60 * 10) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
}

export default supabase;
