import { Suspense } from 'react';

import { LoginForm } from './LoginForm';

export default function LoginPage() {
  return (
    <main className="auth-shell">
      <Suspense fallback={<div className="auth-panel">Loading...</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
