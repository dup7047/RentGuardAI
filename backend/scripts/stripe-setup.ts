/**
 * Phase 0.4 Stripe configuration script.
 *
 * Idempotently creates RentGuard's Stripe products, prices, Customer Portal
 * configuration, and webhook endpoint. Designed to be safe to re-run — every
 * resource is looked up by metadata key first; we only create what's missing.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_...  npm run stripe:setup
 *   STRIPE_SECRET_KEY=sk_test_...  npm run stripe:setup -- --dry-run
 *
 * Env vars (besides STRIPE_SECRET_KEY):
 *   STRIPE_WEBHOOK_URL   — full URL to the backend webhook handler.
 *                          Defaults to https://rentguard-backend.onrender.com/webhooks/stripe
 *                          (the Render staging URL from Phase 0.2). Re-run after
 *                          Phase 1.x ships to point at the real URL.
 *
 * Output:
 *   Prints every resource that was created or already existed, then a
 *   `.env`-style block at the end with STRIPE_LEASE_REVIEW_PRICE_ID,
 *   STRIPE_SEARCH_PASS_PRICE_ID, STRIPE_WEBHOOK_SECRET. Paste into Render env
 *   vars (NEVER commit).
 *
 * No Stripe SDK dependency — talks to the REST API directly so this script
 * has no install footprint and the same code path is testable with a
 * mocked fetch.
 */

import { config as loadDotenv } from "dotenv";

// ---------- product & price catalog ----------

/**
 * Marker we attach to every resource so re-runs can find what we created
 * instead of duplicating. Bump only if you want to fork the catalog.
 */
const METADATA_NAMESPACE = "rentguard_phase04";

interface ProductSpec {
  /** Stable lookup key — written to product.metadata.rentguard_phase04_key. */
  key: "lease_review" | "search_pass_monthly";
  /** Customer-facing product name. */
  name: string;
  /** Customer-facing description. */
  description: string;
  /** Price in cents, USD. */
  amountCents: number;
  /**
   * If "month", a recurring monthly subscription price.
   * If "one_time", a one-shot price.
   */
  billing: "one_time" | "month";
  /** Stripe price.lookup_key for clean lookups. */
  lookupKey: string;
}

const CATALOG: ProductSpec[] = [
  {
    key: "lease_review",
    name: "Lease Review",
    description:
      "AI-powered review of your NYC lease — clause-by-clause analysis, illegal-fee detection, and a written report.",
    amountCents: 2900,
    billing: "one_time",
    lookupKey: "rentguard_lease_review_v1",
  },
  {
    key: "search_pass_monthly",
    name: "Search Pass Monthly",
    description:
      "Unlimited NYC building lookups, landlord watchlist alerts, and saved searches. Cancel anytime.",
    amountCents: 1499,
    billing: "month",
    lookupKey: "rentguard_search_pass_monthly_v1",
  },
];

// Webhook events the backend will subscribe to in Phase 4 (lease checkout) and
// Phase 6 (search-pass subscription). Configured up front so the endpoint
// secret is provisioned before the handler ships.
const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "charge.refunded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
];

// ---------- Stripe API client ----------

const STRIPE_API_BASE = "https://api.stripe.com/v1";

interface StripeListResponse<T> {
  data: T[];
  has_more: boolean;
}

interface StripeProduct {
  id: string;
  name: string;
  description: string | null;
  metadata: Record<string, string>;
  active: boolean;
}

interface StripePrice {
  id: string;
  product: string;
  unit_amount: number;
  currency: string;
  recurring: { interval: string } | null;
  lookup_key: string | null;
  active: boolean;
  metadata: Record<string, string>;
}

interface StripePortalConfig {
  id: string;
  is_default: boolean;
  metadata: Record<string, string>;
  features: { subscription_cancel?: { enabled: boolean } };
}

interface StripeWebhookEndpoint {
  id: string;
  url: string;
  enabled_events: string[];
  secret?: string;
  metadata: Record<string, string>;
}

export interface StripeClient {
  request: <T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
  ) => Promise<T>;
  dryRun: boolean;
}

function encodeForm(body: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [rawK, v] of Object.entries(body)) {
    const k = prefix ? `${prefix}[${rawK}]` : rawK;
    if (v == null) continue;
    if (Array.isArray(v)) {
      v.forEach((item, idx) => {
        if (typeof item === "object" && item !== null) {
          parts.push(encodeForm(item as Record<string, unknown>, `${k}[${idx}]`));
        } else {
          parts.push(`${encodeURIComponent(`${k}[${idx}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof v === "object") {
      parts.push(encodeForm(v as Record<string, unknown>, k));
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

export function makeClient(
  apiKey: string,
  opts: { dryRun?: boolean; fetchImpl?: typeof fetch } = {},
): StripeClient {
  const { dryRun = false, fetchImpl = fetch } = opts;
  return {
    dryRun,
    async request<T>(
      method: "GET" | "POST" | "DELETE",
      path: string,
      body?: Record<string, unknown>,
    ): Promise<T> {
      // Dry-run blocks all writes but allows reads, so the lookup-then-create
      // logic is exercised end-to-end against the live account.
      if (dryRun && method !== "GET") {
        console.log(`  [dry-run] would ${method} ${path}${body ? ` with ${JSON.stringify(body)}` : ""}`);
        return { id: `dryrun_${Math.random().toString(36).slice(2, 10)}`, dry_run: true } as unknown as T;
      }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        "Stripe-Version": "2024-11-20.acacia",
      };
      let url = `${STRIPE_API_BASE}${path}`;
      let payload: string | undefined;
      if (method === "GET" && body) {
        const qs = encodeForm(body);
        if (qs) url += `?${qs}`;
      } else if (body) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        payload = encodeForm(body);
      }
      const res = await fetchImpl(url, { method, headers, body: payload });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`Stripe ${method} ${path} → HTTP ${res.status}: ${errBody.slice(0, 400)}`);
      }
      return (await res.json()) as T;
    },
  };
}

// ---------- idempotent operations ----------

async function findProduct(client: StripeClient, key: string): Promise<StripeProduct | null> {
  const res = await client.request<StripeListResponse<StripeProduct>>("GET", "/products", {
    limit: 100,
    active: true,
  });
  return (
    res.data.find((p) => p.metadata[`${METADATA_NAMESPACE}_key`] === key) ?? null
  );
}

async function findPrice(
  client: StripeClient,
  lookupKey: string,
): Promise<StripePrice | null> {
  const res = await client.request<StripeListResponse<StripePrice>>("GET", "/prices", {
    limit: 100,
    active: true,
    lookup_keys: [lookupKey],
  });
  return res.data[0] ?? null;
}

export async function ensureProductAndPrice(
  client: StripeClient,
  spec: ProductSpec,
): Promise<{ product: StripeProduct; price: StripePrice; created: boolean }> {
  let product = await findProduct(client, spec.key);
  let createdProduct = false;
  if (!product) {
    product = await client.request<StripeProduct>("POST", "/products", {
      name: spec.name,
      description: spec.description,
      metadata: {
        [`${METADATA_NAMESPACE}_key`]: spec.key,
        [`${METADATA_NAMESPACE}_managed`]: "true",
      },
    });
    createdProduct = true;
    console.log(`  created product ${product.id} (${spec.name})`);
  } else {
    console.log(`  reusing product ${product.id} (${spec.name})`);
  }

  let price = await findPrice(client, spec.lookupKey);
  let createdPrice = false;
  if (!price) {
    const priceBody: Record<string, unknown> = {
      product: product.id,
      unit_amount: spec.amountCents,
      currency: "usd",
      lookup_key: spec.lookupKey,
      metadata: { [`${METADATA_NAMESPACE}_key`]: spec.key },
    };
    if (spec.billing === "month") {
      priceBody["recurring"] = { interval: "month" };
    }
    price = await client.request<StripePrice>("POST", "/prices", priceBody);
    createdPrice = true;
    console.log(`  created price ${price.id} ($${(spec.amountCents / 100).toFixed(2)} ${spec.billing})`);
  } else {
    console.log(`  reusing price ${price.id} (lookup_key=${spec.lookupKey})`);
    // Validate the existing price matches what we expect — a mismatch means
    // someone changed the price out-of-band and the script can't safely fix it.
    if (price.unit_amount !== spec.amountCents) {
      throw new Error(
        `price ${price.id} has unit_amount=${price.unit_amount} but spec wants ${spec.amountCents}. ` +
          `Stripe prices are immutable — archive the old one and bump lookupKey to e.g. ${spec.lookupKey.replace(/_v\d+$/, "_v2")}.`,
      );
    }
  }

  return { product, price, created: createdProduct || createdPrice };
}

export async function ensurePortalConfig(client: StripeClient): Promise<StripePortalConfig> {
  // The Customer Portal "configuration" is what controls what features a
  // user sees when they hit billingPortal.sessions.create(). We need it to
  // expose subscription cancel for "Search Pass Monthly".
  const list = await client.request<StripeListResponse<StripePortalConfig>>(
    "GET",
    "/billing_portal/configurations",
    { limit: 100 },
  );
  const existing = list.data.find(
    (c) => c.metadata[`${METADATA_NAMESPACE}_managed`] === "true",
  );
  if (existing) {
    console.log(`  reusing portal config ${existing.id}`);
    return existing;
  }
  const created = await client.request<StripePortalConfig>(
    "POST",
    "/billing_portal/configurations",
    {
      business_profile: {
        headline: "RentGuard NYC — manage your subscription",
      },
      features: {
        subscription_cancel: {
          enabled: true,
          mode: "at_period_end",
          cancellation_reason: {
            enabled: true,
            options: [
              "too_expensive",
              "missing_features",
              "switched_service",
              "unused",
              "other",
            ],
          },
        },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        customer_update: {
          enabled: true,
          allowed_updates: ["email", "name"],
        },
      },
      metadata: { [`${METADATA_NAMESPACE}_managed`]: "true" },
    },
  );
  console.log(`  created portal config ${created.id}`);
  return created;
}

export async function ensureWebhookEndpoint(
  client: StripeClient,
  url: string,
): Promise<StripeWebhookEndpoint> {
  // Webhook endpoints are listed at /webhook_endpoints. Each one has a
  // single signing secret returned ONLY at create time.
  const list = await client.request<StripeListResponse<StripeWebhookEndpoint>>(
    "GET",
    "/webhook_endpoints",
    { limit: 100 },
  );
  const existing = list.data.find((e) => e.url === url);
  if (existing) {
    console.log(`  reusing webhook ${existing.id} → ${existing.url}`);
    // Stripe doesn't return secret on list — caller will need to either
    // rotate via the dashboard or recreate. Print a hint.
    return existing;
  }
  const created = await client.request<StripeWebhookEndpoint>("POST", "/webhook_endpoints", {
    url,
    enabled_events: WEBHOOK_EVENTS,
    description: "RentGuard backend — Phase 0.4 setup",
    metadata: { [`${METADATA_NAMESPACE}_managed`]: "true" },
  });
  console.log(`  created webhook ${created.id} → ${created.url ?? url}`);
  return created;
}

// ---------- main ----------

async function main(): Promise<void> {
  loadDotenv();
  const apiKey = process.env.STRIPE_SECRET_KEY;
  const dryRun = process.argv.includes("--dry-run");
  const webhookUrl =
    process.env.STRIPE_WEBHOOK_URL || "https://rentguard-backend.onrender.com/webhooks/stripe";

  if (!apiKey && !dryRun) {
    console.error(
      "Set STRIPE_SECRET_KEY (test-mode key, sk_test_...) or pass --dry-run to validate the script without API calls.",
    );
    process.exit(1);
  }

  if (apiKey && !apiKey.startsWith("sk_test_")) {
    console.error(
      `Refusing to run: STRIPE_SECRET_KEY does not start with "sk_test_". ` +
        `Phase 0.4 explicitly mandates test mode. To run against live, edit this script.`,
    );
    process.exit(1);
  }

  if (dryRun && !apiKey) {
    // Pure dry-run with no API key: stub the client so it just prints intent.
    console.log("RentGuard Stripe setup — pure dry-run (no API calls, no key).\n");
    const stubFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ data: [], has_more: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const client = makeClient("sk_test_DRYRUN_STUB", { dryRun: true, fetchImpl: stubFetch });
    await runOnce(client, webhookUrl);
    console.log("\nDry-run complete. Provide STRIPE_SECRET_KEY to execute against Stripe.");
    return;
  }

  const client = makeClient(apiKey!, { dryRun });
  console.log(
    `RentGuard Stripe setup — ${dryRun ? "DRY-RUN against live API" : "LIVE WRITE"} (test mode)\n`,
  );
  await runOnce(client, webhookUrl);
}

async function runOnce(client: StripeClient, webhookUrl: string): Promise<void> {
  console.log("Products & prices:");
  const created: Record<string, { productId: string; priceId: string }> = {};
  for (const spec of CATALOG) {
    const { product, price } = await ensureProductAndPrice(client, spec);
    created[spec.key] = { productId: product.id, priceId: price.id };
  }

  console.log("\nCustomer Portal configuration:");
  const portal = await ensurePortalConfig(client);

  console.log(`\nWebhook endpoint (${webhookUrl}):`);
  const webhook = await ensureWebhookEndpoint(client, webhookUrl);

  console.log("\n----- copy into Render env vars (DO NOT COMMIT) -----");
  console.log(`STRIPE_LEASE_REVIEW_PRICE_ID=${created["lease_review"]?.priceId ?? "<missing>"}`);
  console.log(`STRIPE_SEARCH_PASS_PRICE_ID=${created["search_pass_monthly"]?.priceId ?? "<missing>"}`);
  console.log(`STRIPE_PORTAL_CONFIG_ID=${portal.id}`);
  console.log(`STRIPE_WEBHOOK_ID=${webhook.id}`);
  if (webhook.secret) {
    console.log(`STRIPE_WEBHOOK_SECRET=${webhook.secret}`);
  } else {
    console.log("# STRIPE_WEBHOOK_SECRET=<reveal in Stripe dashboard → Webhooks → click endpoint → Signing secret>");
  }
  console.log("----- end -----");
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("stripe-setup.ts") === true ||
  process.argv[1]?.endsWith("stripe-setup.js") === true;
if (invokedDirectly) {
  main().catch((err) => {
    console.error("stripe-setup crashed:", err);
    process.exit(1);
  });
}
