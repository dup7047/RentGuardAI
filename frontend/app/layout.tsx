import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { NavBar } from '@/components/NavBar';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'RentGuard NYC — AI Rental Copilot',
  description:
    'Free building risk lookup and AI lease review for NYC renters. Check any address against HPD violations, DOB complaints, and landlord records.',
  metadataBase: new URL('https://rentguard.cc'),
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
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body data-density="comfy">
        <div className="shell">
          <NavBar />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
