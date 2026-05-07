import { Suspense } from 'react';
import { LookupForm } from './LookupForm';

export const metadata = {
  title: 'Look up a building — RentGuard NYC',
  description:
    'Enter an NYC address or listing URL to get an AI-powered risk summary from public records.',
};

export default function LookupPage() {
  return (
    <Suspense fallback={null}>
      <LookupForm />
    </Suspense>
  );
}
