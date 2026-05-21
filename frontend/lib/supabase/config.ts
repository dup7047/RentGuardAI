// Auth cookies must be readable by JS — @supabase/ssr's browser client reads
// document.cookie to hydrate the session. Setting httpOnly here would leave
// server components working but break every client component that calls
// supabase.auth.getUser() (e.g. NavAuthCta), producing a logged-out nav on a
// logged-in dashboard. Server and browser share one set of options.
export const supabaseCookieOptions = {
  name: 'rentguard-auth',
  path: '/',
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
};

export const supabaseServerCookieOptions = supabaseCookieOptions;

export function getSupabaseUrl() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!supabaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  }

  return supabaseUrl;
}

export function getSupabaseAnonKey() {
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY',
    );
  }

  return supabaseAnonKey;
}
