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

const SITE_URL = 'https://www.rentguard.cc';

export const metadata: Metadata = {
  title: 'RentGuard NYC: AI Rental Copilot',
  description:
    'Free building risk lookup for NYC renters. Check any address against HPD violations, DOB complaints, eviction records, and landlord data.',
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: '/' },
  openGraph: {
    title: 'RentGuard NYC',
    description: 'AI-powered NYC building lookup from public records.',
    url: SITE_URL,
    siteName: 'RentGuard NYC',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RentGuard NYC',
    description: 'AI-powered NYC building lookup from public records.',
  },
};

const siteJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#org`,
    name: 'RentGuard NYC',
    legalName: 'RentGuard NYC LLC',
    url: SITE_URL,
    logo: `${SITE_URL}/logo-lockup.png`,
    areaServed: { '@type': 'City', name: 'New York City' },
    email: 'support@rentguard.cc',
    sameAs: [],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: 'RentGuard NYC',
    publisher: { '@id': `${SITE_URL}/#org` },
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  },
];

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

// Cloudflare Web Analytics. Cookieless, no consent banner
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
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
