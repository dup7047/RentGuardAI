import type { EmailOtpType } from '@supabase/supabase-js';
import Link from 'next/link';

import { createClient } from '@/lib/supabase/server';

import { ResetPasswordForm } from './ResetPasswordForm';

type SearchParams = Promise<{
  token_hash?: string | string[];
  type?: string | string[];
}>;

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

function pickFirst(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const tokenHash = pickFirst(params.token_hash);
  const type = pickFirst(params.type);

  if (!tokenHash || type !== 'recovery') {
    return <ExpiredLink />;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as EmailOtpType,
  });
  if (error) {
    return <ExpiredLink />;
  }

  return (
    <main className="auth-shell">
      <ResetPasswordForm />
    </main>
  );
}
