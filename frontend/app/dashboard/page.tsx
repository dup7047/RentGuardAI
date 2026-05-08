// Dashboard — auth-gated server component. Auth + header are server-rendered;
// the saved-buildings list is a child client component that fetches /v1/saved-buildings
// and handles the optimistic Unsave UX.

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { signOut } from './actions';
import { SavedBuildingsList } from './SavedBuildingsList';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?redirectTo=/dashboard');
  }

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

      <SavedBuildingsList />
    </div>
  );
}
