import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),

  // Drop the `x-powered-by: Next.js` response header — it leaks the framework
  // and contributes nothing useful.
  poweredByHeader: false,

  // Serve images as AVIF first, then WebP — significantly smaller than PNG.
  // next/image handles negotiation automatically via the Accept header.
  images: {
    formats: ['image/avif', 'image/webp'],
    // Logo is served at 36px height; restrict generated sizes to avoid
    // caching dozens of variants for a simple nav logo.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },

  // Aggressive caching for static assets — they are content-hashed by Next.js
  // so a year-long TTL is safe.
  async headers() {
    return [
      {
        // Global security headers. CSP is intentionally omitted here — it
        // needs a report-only iteration against the live origin set
        // (Supabase + Cloudflare beacon + Vercel) before enforcing.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self)',
          },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/logo-lockup.png',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/logo-mark.png',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
    ];
  },

  // /lookup is a legacy URL — the homepage IS the lookup surface.
  // Permanent (301) so search engines retire the duplicate URL.
  async redirects() {
    return [
      { source: '/lookup', destination: '/', permanent: true },
    ];
  },
};

export default nextConfig;
