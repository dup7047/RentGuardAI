// Dashboard — auth-gated. Empty-state design for now (saved-buildings
// backend ships in a separate phase).

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { signOut } from './actions';

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
          <Link href="/lookup" className="btn primary">
            + New lookup
          </Link>
          <form action={signOut}>
            <button className="btn ghost sm" type="submit">
              Log out
            </button>
          </form>
        </div>
      </div>

      <div className="card dashboard-empty">
        <div className="icn" aria-hidden="true">
          ★
        </div>
        <h2>No saved buildings yet</h2>
        <p>
          Run a lookup and tap{' '}
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
            ★ Save building
          </span>{' '}
          on any report — we&apos;ll re-check it every Monday and email you any
          new violations.
        </p>
        <Link
          href="/lookup"
          className="btn primary"
          style={{ marginTop: 8 }}
        >
          Run your first lookup →
        </Link>
      </div>
    </div>
  );
}
