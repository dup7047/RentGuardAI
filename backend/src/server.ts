import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { logger } from './logger.js';
import { getCommitSha } from './commit.js';

const port = Number.parseInt(process.env.PORT ?? '8080', 10);
const app = createApp();

serve({ fetch: app.fetch, port }, (info) => {
  logger.info(
    { port: info.port, commit: getCommitSha(), nodeEnv: process.env.NODE_ENV ?? 'development' },
    'rentguard backend listening'
  );
});
