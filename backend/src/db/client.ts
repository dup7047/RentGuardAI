import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.length === 0) {
    throw new Error(
      'DATABASE_URL is not set. Copy backend/.env.example to backend/.env or export it before running.'
    );
  }
  return url;
}

export function createPool(connectionString: string = getDatabaseUrl()): pg.Pool {
  const usesSsl = /sslmode=require|supabase\.co/.test(connectionString);
  return new pg.Pool({
    connectionString,
    // Supabase free tier supports 60 direct connections; 20 per dyno leaves
    // headroom for migrations + concurrent dynos.
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
    ...(usesSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}

let cachedPool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (cachedPool === null) {
    cachedPool = createPool();
  }
  return cachedPool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}
