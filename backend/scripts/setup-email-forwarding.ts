/**
 * Email forwarding setup via Cloudflare Email Routing API.
 *
 * For each domain, this script:
 *   1. Looks up the Cloudflare zone ID
 *   2. Enables Email Routing on the zone (idempotent)
 *   3. Creates a forwarding rule for every project alias
 *
 * Prerequisites (one-time, in Cloudflare dashboard):
 *   - Both domains added to Cloudflare and using Cloudflare nameservers
 *   - Email Routing enabled per domain (Dashboard → Email → Email Routing → Enable)
 *   - Destination address dantino12@gmail.com verified
 *     (Dashboard → Email → Email Routing → Destination addresses → Add)
 *   - API token with Zone / Email Routing Rules / Edit permission for both domains
 *
 * Run:
 *   CLOUDFLARE_API_TOKEN=<token> npm run email:forwarding
 *
 * Exits 0 on full pass, 1 on any failure.
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv();

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const FORWARD_TO = process.env.FORWARD_TO_EMAIL ?? 'dantino12@gmail.com';
const BASE = 'https://api.cloudflare.com/client/v4';

const ALIASES: Record<string, string[]> = {
  'rentguard.nyc': ['support', 'privacy', 'legal', 'ops'],
  'rentguard.cc':  ['corrections', 'owners', 'lease-review-waitlist', 'firms', 'noreply'],
};

if (!TOKEN) {
  console.error(
    'Error: CLOUDFLARE_API_TOKEN is not set.\n' +
    'Get a token at https://dash.cloudflare.com/profile/api-tokens\n' +
    'Permission needed: Zone → Email Routing Rules → Edit',
  );
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function cfFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  const json = await res.json() as { success: boolean; result: unknown; errors: { message: string }[] };
  if (!json.success) throw new Error(json.errors.map((e) => e.message).join(', '));
  return json.result;
}

async function getZoneId(domain: string): Promise<string> {
  const result = await cfFetch(`/zones?name=${domain}`) as { id: string }[];
  if (!result.length) throw new Error(`Domain "${domain}" not found in this Cloudflare account`);
  return result[0].id;
}

async function enableEmailRouting(zoneId: string): Promise<void> {
  await cfFetch(`/zones/${zoneId}/email/routing/enable`, { method: 'POST' }).catch(() => {
    // Already enabled — ignore the error
  });
}

async function createRule(zoneId: string, alias: string, domain: string): Promise<boolean> {
  const address = `${alias}@${domain}`;
  try {
    await cfFetch(`/zones/${zoneId}/email/routing/rules`, {
      method: 'POST',
      body: JSON.stringify({
        name: `Forward ${alias}`,
        enabled: true,
        matchers: [{ type: 'literal', field: 'to', value: address }],
        actions:  [{ type: 'forward', value: [FORWARD_TO] }],
      }),
    });
    console.log(`  ✓  ${address}  →  ${FORWARD_TO}`);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Rule already exists — treat as success
    if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('duplicate')) {
      console.log(`  ✓  ${address}  →  ${FORWARD_TO}  (already exists)`);
      return true;
    }
    console.error(`  ✗  ${address}: ${msg}`);
    return false;
  }
}

async function main(): Promise<void> {
  console.log(`\nCloudflare Email Routing setup  →  ${FORWARD_TO}\n`);

  let allOk = true;

  for (const [domain, aliases] of Object.entries(ALIASES)) {
    console.log(`${domain}`);
    let zoneId: string;
    try {
      zoneId = await getZoneId(domain);
    } catch (err: unknown) {
      console.error(`  ✗  ${err instanceof Error ? err.message : err}`);
      allOk = false;
      console.log();
      continue;
    }

    await enableEmailRouting(zoneId);

    const results = await Promise.all(aliases.map((a) => createRule(zoneId, a, domain)));
    if (results.some((ok) => !ok)) allOk = false;
    console.log();
  }

  if (!allOk) {
    console.error('One or more rules failed — check errors above.');
    process.exit(1);
  }

  console.log('All rules configured. Verify at:');
  console.log('  https://dash.cloudflare.com → rentguard.cc → Email → Email Routing');
  console.log('  https://dash.cloudflare.com → rentguard.nyc → Email → Email Routing\n');
}

main();
