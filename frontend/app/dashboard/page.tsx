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
    <main className="dashboard-shell">
      <section className="dashboard-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Welcome back</h1>
          <p className="auth-copy">{user.email}</p>
        </div>
        <form action={signOut}>
          <button className="secondary-button" type="submit">
            Log out
          </button>
        </form>
      </section>

      <section className="dashboard-grid">
        <article className="dashboard-card">
          <p className="eyebrow">Account</p>
          <h2>Session active</h2>
          <p>
            Your Supabase Auth session is available to server components through
            SSR cookies.
          </p>
        </article>
        <article className="dashboard-card">
          <p className="eyebrow">Next up</p>
          <h2>Building lookup</h2>
          <p>
            Phase 3 can now use authenticated users for dashboard access and
            higher lookup limits.
          </p>
        </article>
      </section>
    </main>
  );
}
