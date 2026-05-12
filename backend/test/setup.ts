// Vitest setup — runs before every test file is loaded.
// Sets the env vars that auth middleware requires at module load,
// so static-import tests don't have to repeat the dance.
export {};

process.env.SUPABASE_JWT_SECRET ??=
  'super-secret-jwt-token-with-at-least-32-characters-long';
process.env.SUPABASE_URL ??= 'http://localhost:54321';

// Node <19 lacks the WebCrypto global that `jose` uses for HS256 signing.
// CI runs Node 20+, but local dev boxes may still be on 18 — polyfill so
// `signToken()` helpers don't crash with `crypto is not defined`. Cheap; the
// `import('node:crypto')` is sync-cached after the first call.
if (typeof globalThis.crypto === 'undefined') {
  const { webcrypto } = await import('node:crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: false,
  });
}
