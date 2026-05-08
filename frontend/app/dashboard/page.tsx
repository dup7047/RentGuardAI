// Dashboard — auth-gated server component. The saved-buildings list is
// fetched server-side here so we don't depend on Supabase client-side cookie
// parsing (which fails on some Safari sessions with "The string did not match
// the expected pattern"). The child client component handles the optimistic
// Unsave UX via a server action.

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { loadSavedBuildings, signOut } from './actions';
import { SavedBuildingsList } from './SavedBuildingsList';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?redirectTo=/dashboard');
  }

  // getUser() above warmed the client's in-memory session cache, so this
  // getSession() reads from cache and never re-hits the network.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token ?? '';

  const initial = await loadSavedBuildings(token);

  // CRITICAL: do NOT redirect on `unauthorized` from the backend even though
  // Supabase already confirmed `user` above. If the backend's SUPABASE_URL /
  // JWT secret are misconfigured (every token rejected with bad_iss), or if
  // getAccessToken()'s getSession() returns null due to Safari chunked-cookie
  // parsing, redirecting to /login causes an infinite loop:
  //   /dashboard (backend says 401) → /login (Supabase says authed) → /dashboard …
  // Render the page in a degraded state instead. The list component already
  // shows a "couldn't load" card for kind: 'error', so we coerce the
  // unauthorized result into that shape and let the user see something usable.
  const listProps =
    initial.kind === 'unauthorized' ? ({ kind: 'error' } as const) : initial;

  return (
    <div className="container screen-fade">
      <div className="dash-head">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Saved buildings</h1>
          <p className="auth-copy">Signed in as {user.email}</p>
        </div>
        <div className="actions">
          <Link href="/" className="btn primary">
            + New lookup
          </Link>
          <form action={signOut}>
            <button className="btn ghost sm" type="submit">
              Log out
            </button>
          </form>
        </div>
      </div>

      <SavedBuildingsList initial={listProps} />
    </div>
  );
}
