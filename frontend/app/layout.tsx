import type { Metadata } from 'next';
import Script from 'next/script';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { NavBar } from '@/components/NavBar';
import { SiteFooter } from '@/components/SiteFooter';
import './globals.css';

// Three weights cover all uses (body=400, semibold=600, bold=700).
// Dropping 500 and 800 saves ~40 KB of font payload.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
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
    'Free building risk lookup for NYC renters. Check any address against HPD violations, DOB complaints, eviction records, and landlord data.',
  metadataBase: new URL('https://rentguard.cc'),
  openGraph: {
    title: 'RentGuard NYC',
    description: 'AI-powered NYC building lookup from public records.',
    type: 'website',
  },
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

// Phase 11.8: Cloudflare Web Analytics. Cookieless, no consent banner
// needed. Token is set in Vercel project env vars (NEXT_PUBLIC_CF_ANALYTICS_TOKEN);
// when missing, the script is skipped so dev / preview builds don't ship a
// broken beacon. Dashboard URL is recorded in docs/runbook/analytics.md.
const cfAnalyticsToken = process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* Warm up the connection to Supabase before any auth/data fetch fires */}
        {supabaseUrl && (
          <link rel="preconnect" href={supabaseUrl} crossOrigin="anonymous" />
        )}
        {/* Google Fonts is handled by next/font (self-hosted), so no preconnect needed */}
      </head>
      <body data-density="comfy">
        <div className="shell">
          <NavBar />
          <main>{children}</main>
          <SiteFooter />
        </div>
        {cfAnalyticsToken && (
          <Script
            id="cf-web-analytics"
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={`{"token": "${cfAnalyticsToken}"}`}
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
