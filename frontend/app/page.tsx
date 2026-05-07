import { Suspense } from 'react';
import { LookupForm } from './lookup/LookupForm';

export const metadata = {
  title: 'RentGuard NYC — Look up any building before you sign',
  description:
    'Enter an NYC address or listing URL to get an AI-powered risk summary from HPD violations, DOB complaints, landlord records, and tenant law.',
};

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <LookupForm />
    </Suspense>
  );
}
