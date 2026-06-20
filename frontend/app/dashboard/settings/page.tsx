import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { DeleteAccountSection } from './DeleteAccountSection';

export const metadata: Metadata = {
  title: 'Settings | RentGuard NYC',
  description: 'Manage your RentGuard account, sign out, or delete your account.',
};

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?redirectTo=/dashboard/settings');
  }

  return (
    <div className="container screen-fade" style={{ paddingTop: 32, paddingBottom: 48 }}>
      <div className="hero-center" style={{ marginBottom: 16 }}>
        <h1 className="hero" style={{ fontSize: 28 }}>
          Settings
        </h1>
        <p className="hero-sub">Manage your RentGuard account.</p>
      </div>

      <div className="card panel" style={{ marginBottom: 16 }}>
        <h3>Account</h3>
        <p style={{ fontSize: 14, color: 'var(--ink-2)' }}>
          Signed in as <strong>{user.email}</strong>.
        </p>
      </div>

      <div className="card panel">
        <h3>Delete account</h3>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          Mark your account for deletion. We will email you a 30-day undo link
          so you can change your mind. After 30 days, your saved buildings and
          profile are permanently removed.
        </p>
        <DeleteAccountSection />
      </div>
    </div>
  );
}
