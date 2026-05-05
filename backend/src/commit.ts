import { execSync } from 'node:child_process';

let cached: string | null = null;

export function getCommitSha(): string {
  if (cached !== null) return cached;

  const fromEnv =
    process.env.GIT_COMMIT_SHA ??
    process.env.RENDER_GIT_COMMIT ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA;

  if (fromEnv && fromEnv.length > 0) {
    cached = fromEnv;
    return cached;
  }

  try {
    cached = execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    cached = 'unknown';
  }
  return cached;
}
