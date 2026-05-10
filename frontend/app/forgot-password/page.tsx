import { Suspense } from 'react';

import { ForgotPasswordForm } from './ForgotPasswordForm';

export default function ForgotPasswordPage() {
  return (
    <main className="auth-shell">
      <Suspense fallback={<div className="auth-panel">Loading...</div>}>
        <ForgotPasswordForm />
      </Suspense>
    </main>
  );
}
