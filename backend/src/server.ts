import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { logger } from './logger.js';
import { getCommitSha } from './commit.js';
import { getPool } from './db/client.js';

const port = Number.parseInt(process.env.PORT ?? '8080', 10);
const app = createApp();

serve({ fetch: app.fetch, port }, (info) => {
  logger.info(
    { port: info.port, commit: getCommitSha(), nodeEnv: process.env.NODE_ENV ?? 'development' },
    'rentguard backend listening'
  );
  // Best-effort: log this month's Firecrawl credit usage so quota crunches
  // are visible before users hit them. Sums fetch_cost_credits stored by
  // scraping/cache.ts on each successful Firecrawl fetch. Failures are
  // swallowed so a transient DB issue can't crash the boot.
  void logFirecrawlMonthlyCreditUsage();
});

async function logFirecrawlMonthlyCreditUsage(): Promise<void> {
  try {
    const res = await getPool().query<{ used: number }>(
      `SELECT COALESCE(SUM(fetch_cost_credits), 0)::int AS used
       FROM scraped_listings
       WHERE created_at >= date_trunc('month', NOW())
         AND fetch_method = 'firecrawl'`,
    );
    const used = res.rows[0]?.used ?? 0;
    // Firecrawl free tier is 500 credits one-time, not monthly. Surface raw
    // usage; the threshold env var lets ops tune the warning band per plan.
    const FREE_TIER_CREDITS = Number.parseInt(
      process.env.FIRECRAWL_FREE_TIER_CREDITS ?? '500',
      10,
    );
    if (used >= FREE_TIER_CREDITS * 0.8) {
      logger.warn(
        { firecrawl_credits_used_this_month: used, freeTierCredits: FREE_TIER_CREDITS },
        'Firecrawl usage above 80% of plan threshold — top up before exhaustion',
      );
    } else {
      logger.info(
        { firecrawl_credits_used_this_month: used, freeTierCredits: FREE_TIER_CREDITS },
        'Firecrawl monthly usage',
      );
    }
  } catch (e) {
    logger.warn({ err: String(e) }, 'failed to read Firecrawl monthly usage');
  }
}
