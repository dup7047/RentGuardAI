// Vitest setup — runs before every test file is loaded.
// Sets the env vars that auth middleware requires at module load,
// so static-import tests don't have to repeat the dance.

process.env.SUPABASE_JWT_SECRET ??=
  'super-secret-jwt-token-with-at-least-32-characters-long';
process.env.SUPABASE_URL ??= 'http://localhost:54321';
