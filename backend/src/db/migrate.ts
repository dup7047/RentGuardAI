import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createPool, getDatabaseUrl } from './client.js';
import { logger } from '../logger.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(HERE, '../../drizzle');

export async function runMigrations(connectionString?: string): Promise<void> {
  const url = connectionString ?? getDatabaseUrl();
  const pool = createPool(url);
  const db = drizzle(pool);
  try {
    logger.info({ migrationsFolder: MIGRATIONS_FOLDER }, 'applying migrations');
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    logger.info('migrations applied');
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntrypoint) {
  runMigrations().catch((err: unknown) => {
    logger.error({ err }, 'migrations failed');
    process.exitCode = 1;
  });
}
