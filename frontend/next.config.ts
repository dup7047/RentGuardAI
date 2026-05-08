import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),

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
};

export default nextConfig;
