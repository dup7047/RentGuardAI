import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RentGuard NYC — AI Rental Copilot',
  description:
    'Free building risk lookup and AI lease review for NYC renters. Check any address against HPD violations, DOB complaints, and landlord records.',
  openGraph: {
    title: 'RentGuard NYC',
    description: 'AI-powered NYC rental copilot. Avoid bad apartments.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
