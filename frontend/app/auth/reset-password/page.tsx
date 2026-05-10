import Link from 'next/link';

import { createClient } from '@/lib/supabase/server';

import { ResetPasswordForm } from './ResetPasswordForm';

type SearchParams = Promise<{ code?: string | string[] }>;

function ExpiredLink() {
  return (
    <main className="auth-shell">
      <div className="auth-panel">
        <div>
          <p className="eyebrow">RentGuard account</p>
          <h1>This link is no longer valid</h1>
          <p className="auth-copy">
            Password reset links expire and can only be used once. Request a
            new one to continue.
          </p>
        </div>
        <Link className="primary-button" href="/forgot-password">
          Request a new link
        </Link>
        <Link className="link-button" href="/login">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { code: rawCode } = await searchParams;
  const code = Array.isArray(rawCode) ? rawCode[0] : rawCode;

  if (!code) {
    return <ExpiredLink />;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return <ExpiredLink />;
  }

  return (
    <main className="auth-shell">
      <ResetPasswordForm />
    </main>
  );
}
