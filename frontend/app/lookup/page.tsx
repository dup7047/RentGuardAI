import { Suspense } from 'react';
import { LookupForm } from './LookupForm';

export const metadata = {
  title: 'Look up a building — RentGuard NYC',
  description: 'Enter an NYC address or listing URL to get an AI-powered risk summary from public records.',
};

export default function LookupPage() {
  return (
    <main className="lookup-shell">
      <h1>Look up a building</h1>
      <p>Enter a New York City address or StreetEasy / Zillow listing URL.</p>
      <Suspense fallback={<p>Loading…</p>}>
        <LookupForm />
      </Suspense>
    </main>
  );
}
