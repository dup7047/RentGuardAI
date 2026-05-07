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
  // Best-effort: log this month's ScrapFly credit usage so quota crunches
  // are visible before users hit them. Sums fetch_cost_credits stored by
  // scraping/cache.ts on each successful ScrapFly fetch. Failures are
  // swallowed so a transient DB issue can't crash the boot.
  void logScrapflyMonthlyCreditUsage();
});

async function logScrapflyMonthlyCreditUsage(): Promise<void> {
  try {
    const res = await getPool().query<{ used: number }>(
      `SELECT COALESCE(SUM(fetch_cost_credits), 0)::int AS used
       FROM scraped_listings
       WHERE created_at >= date_trunc('month', NOW())
         AND fetch_method = 'scrapfly'`,
    );
    const used = res.rows[0]?.used ?? 0;
    const FREE_TIER_CREDITS = 1000;
    const pct = Math.round((used / FREE_TIER_CREDITS) * 100);
    if (used >= FREE_TIER_CREDITS * 0.8) {
      logger.warn(
        { scrapfly_credits_used_this_month: used, freeTierCredits: FREE_TIER_CREDITS, pctUsed: pct },
        'ScrapFly free-tier usage above 80% — top up before quota exhaustion',
      );
    } else {
      logger.info(
        { scrapfly_credits_used_this_month: used, freeTierCredits: FREE_TIER_CREDITS, pctUsed: pct },
        'ScrapFly monthly usage',
      );
    }
  } catch (e) {
    logger.warn({ err: String(e) }, 'failed to read ScrapFly monthly usage');
  }
}
