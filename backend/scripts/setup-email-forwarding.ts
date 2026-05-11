/**
 * Email forwarding setup via ForwardEmail.net API.
 *
 * Creates forwarding aliases on both project domains so that every
 * contact/ops address delivers to FORWARD_TO_EMAIL (dantino12@gmail.com by
 * default, overridable via env).
 *
 * Prerequisites:
 *   1. Create a free account at https://forwardemail.net
 *   2. Add `rentguard.nyc` and `rentguard.cc` to your ForwardEmail account.
 *   3. Apply the MX + TXT DNS records shown in docs/email-forwarding.md to
 *      both domains at your registrar.
 *   4. Set FORWARDEMAIL_API_KEY in your environment (or .env file).
 *
 * Run:
 *   npm run email:forwarding
 *   FORWARD_TO_EMAIL=other@example.com npm run email:forwarding
 *
 * Exits 0 on full pass, 1 on any failure.
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv();

const API_KEY = process.env.FORWARDEMAIL_API_KEY;
const FORWARD_TO = process.env.FORWARD_TO_EMAIL ?? 'dantino12@gmail.com';
const BASE_URL = 'https://api.forwardemail.net/v1';

// All project email addresses that should forward to FORWARD_TO.
const ALIASES: Record<string, string[]> = {
  'rentguard.nyc': ['support', 'privacy', 'legal', 'ops'],
  'rentguard.cc': ['corrections', 'owners', 'lease-review-waitlist', 'firms', 'noreply'],
};

if (!API_KEY) {
  console.error(
    'Error: FORWARDEMAIL_API_KEY is not set.\n' +
    'Get your API key at https://forwardemail.net/my-account/security\n' +
    'then add it to .env or export it in your shell.',
  );
  process.exit(1);
}

const authHeader = `Basic ${Buffer.from(`${API_KEY}:`).toString('base64')}`;

async function upsertAlias(domain: string, name: string): Promise<boolean> {
  const address = `${name}@${domain}`;

  // Try create first; if the alias already exists the API returns 409 — treat
  // that as success since the desired state is already achieved.
  const res = await fetch(`${BASE_URL}/domains/${domain}/aliases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify({
      name,
      recipients: [FORWARD_TO],
      is_enabled: true,
    }),
  });

  if (res.ok || res.status === 409) {
    const verb = res.status === 409 ? 'already exists' : 'created';
    console.log(`  ✓  ${address}  →  ${FORWARD_TO}  (${verb})`);
    return true;
  }

  const body = await res.text().catch(() => '');
  console.error(`  ✗  ${address}: HTTP ${res.status}  ${body}`);
  return false;
}

async function main(): Promise<void> {
  console.log(`\nForwardEmail alias setup  →  ${FORWARD_TO}\n`);

  let allOk = true;

  for (const [domain, names] of Object.entries(ALIASES)) {
    console.log(`${domain}`);
    const results = await Promise.all(names.map((n) => upsertAlias(domain, n)));
    if (results.some((ok) => !ok)) allOk = false;
    console.log();
  }

  if (!allOk) {
    console.error('One or more aliases failed. Check errors above.');
    process.exit(1);
  }

  console.log('All aliases configured. Verify in the ForwardEmail dashboard:');
  console.log('  https://forwardemail.net/my-account/domains\n');
}

main();
