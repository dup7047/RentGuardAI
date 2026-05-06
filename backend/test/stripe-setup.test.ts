/**
 * Unit tests for the Phase 0.4 Stripe setup script. Mocks the Stripe REST API
 * to validate: idempotent product creation, price reuse via lookup_key,
 * portal-config dedup via metadata, webhook dedup via URL, and rejection of
 * mismatched price amounts.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ensureProductAndPrice,
  ensurePortalConfig,
  ensureWebhookEndpoint,
  makeClient,
} from "../scripts/stripe-setup.js";

interface MockState {
  products: Array<Record<string, unknown>>;
  prices: Array<Record<string, unknown>>;
  portals: Array<Record<string, unknown>>;
  webhooks: Array<Record<string, unknown>>;
}

function makeMockFetch(state: MockState): typeof fetch {
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}_${++idCounter}`;
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v1/, "");
    const method = init?.method ?? "GET";

    function ok(body: unknown): Response {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (method === "GET" && path === "/products") {
      return ok({ data: state.products, has_more: false });
    }
    if (method === "GET" && path === "/prices") {
      // honor lookup_keys[] filter
      const keys = u.searchParams.getAll("lookup_keys[0]").concat(u.searchParams.getAll("lookup_keys[]"));
      const filtered = keys.length
        ? state.prices.filter((p) => keys.includes(p["lookup_key"] as string))
        : state.prices;
      return ok({ data: filtered, has_more: false });
    }
    if (method === "GET" && path === "/billing_portal/configurations") {
      return ok({ data: state.portals, has_more: false });
    }
    if (method === "GET" && path === "/webhook_endpoints") {
      return ok({ data: state.webhooks, has_more: false });
    }

    if (method === "POST") {
      const formBody = init?.body ? new URLSearchParams(init.body as string) : new URLSearchParams();
      const body: Record<string, unknown> = {};
      for (const [k, v] of formBody) body[k] = v;

      if (path === "/products") {
        const id = nextId("prod");
        const meta: Record<string, string> = {};
        for (const [k, v] of formBody) {
          const m = k.match(/^metadata\[(.+)\]$/);
          if (m) meta[m[1]!] = v;
        }
        const product = {
          id,
          name: body["name"],
          description: body["description"],
          metadata: meta,
          active: true,
        };
        state.products.push(product);
        return ok(product);
      }
      if (path === "/prices") {
        const id = nextId("price");
        const meta: Record<string, string> = {};
        for (const [k, v] of formBody) {
          const m = k.match(/^metadata\[(.+)\]$/);
          if (m) meta[m[1]!] = v;
        }
        const recurringInterval = body["recurring[interval]"];
        const price = {
          id,
          product: body["product"],
          unit_amount: Number(body["unit_amount"]),
          currency: body["currency"],
          recurring: recurringInterval ? { interval: recurringInterval } : null,
          lookup_key: body["lookup_key"],
          active: true,
          metadata: meta,
        };
        state.prices.push(price);
        return ok(price);
      }
      if (path === "/billing_portal/configurations") {
        const id = nextId("bpc");
        const meta: Record<string, string> = {};
        for (const [k, v] of formBody) {
          const m = k.match(/^metadata\[(.+)\]$/);
          if (m) meta[m[1]!] = v;
        }
        const portal = {
          id,
          is_default: false,
          metadata: meta,
          features: { subscription_cancel: { enabled: true } },
        };
        state.portals.push(portal);
        return ok(portal);
      }
      if (path === "/webhook_endpoints") {
        const id = nextId("we");
        const meta: Record<string, string> = {};
        for (const [k, v] of formBody) {
          const m = k.match(/^metadata\[(.+)\]$/);
          if (m) meta[m[1]!] = v;
        }
        const events: string[] = [];
        for (const [k, v] of formBody) {
          if (k.startsWith("enabled_events[")) events.push(v);
        }
        const webhook = {
          id,
          url: body["url"],
          enabled_events: events,
          secret: `whsec_${id}`,
          metadata: meta,
        };
        state.webhooks.push(webhook);
        return ok(webhook);
      }
    }
    return new Response("not mocked: " + method + " " + path, { status: 500 });
  };
}

const sampleProduct = {
  key: "lease_review" as const,
  name: "Lease Review",
  description: "AI lease review",
  amountCents: 2900,
  billing: "one_time" as const,
  lookupKey: "rentguard_lease_review_v1",
};

describe("ensureProductAndPrice", () => {
  it("creates product + price on first run", async () => {
    const state: MockState = { products: [], prices: [], portals: [], webhooks: [] };
    const client = makeClient("sk_test_x", { fetchImpl: makeMockFetch(state) });

    const result = await ensureProductAndPrice(client, sampleProduct);

    expect(result.product.id).toMatch(/^prod_/);
    expect(result.price.id).toMatch(/^price_/);
    expect(result.price.unit_amount).toBe(2900);
    expect(result.price.lookup_key).toBe("rentguard_lease_review_v1");
    expect(result.created).toBe(true);
    expect(state.products).toHaveLength(1);
    expect(state.prices).toHaveLength(1);
  });

  it("is idempotent — second run reuses existing product and price", async () => {
    const state: MockState = { products: [], prices: [], portals: [], webhooks: [] };
    const client = makeClient("sk_test_x", { fetchImpl: makeMockFetch(state) });

    const first = await ensureProductAndPrice(client, sampleProduct);
    const second = await ensureProductAndPrice(client, sampleProduct);

    expect(second.product.id).toBe(first.product.id);
    expect(second.price.id).toBe(first.price.id);
    expect(second.created).toBe(false);
    expect(state.products).toHaveLength(1);
    expect(state.prices).toHaveLength(1);
  });

  it("rejects when an existing price has a mismatched amount", async () => {
    const state: MockState = {
      products: [
        {
          id: "prod_existing",
          name: "Lease Review",
          description: null,
          metadata: { rentguard_phase04_key: "lease_review", rentguard_phase04_managed: "true" },
          active: true,
        },
      ],
      prices: [
        {
          id: "price_existing",
          product: "prod_existing",
          unit_amount: 1900, // wrong — spec wants 2900
          currency: "usd",
          recurring: null,
          lookup_key: "rentguard_lease_review_v1",
          active: true,
          metadata: {},
        },
      ],
      portals: [],
      webhooks: [],
    };
    const client = makeClient("sk_test_x", { fetchImpl: makeMockFetch(state) });

    await expect(ensureProductAndPrice(client, sampleProduct)).rejects.toThrow(/unit_amount=1900/);
  });

  it("attaches the recurring interval for monthly billing", async () => {
    const state: MockState = { products: [], prices: [], portals: [], webhooks: [] };
    const client = makeClient("sk_test_x", { fetchImpl: makeMockFetch(state) });

    const monthly = {
      ...sampleProduct,
      key: "search_pass_monthly" as const,
      billing: "month" as const,
      lookupKey: "rentguard_search_pass_monthly_v1",
      amountCents: 1499,
    };

    const result = await ensureProductAndPrice(client, monthly);
    expect(result.price.recurring?.interval).toBe("month");
    expect(result.price.unit_amount).toBe(1499);
  });
});

describe("ensurePortalConfig", () => {
  it("creates the portal config on first run", async () => {
    const state: MockState = { products: [], prices: [], portals: [], webhooks: [] };
    const client = makeClient("sk_test_x", { fetchImpl: makeMockFetch(state) });

    const portal = await ensurePortalConfig(client);
    expect(portal.id).toMatch(/^bpc_/);
    expect(state.portals).toHaveLength(1);
  });

  it("is idempotent — reuses configs marked with our metadata", async () => {
    const state: MockState = { products: [], prices: [], portals: [], webhooks: [] };
    const client = makeClient("sk_test_x", { fetchImpl: makeMockFetch(state) });

    const first = await ensurePortalConfig(client);
    const second = await ensurePortalConfig(client);
    expect(second.id).toBe(first.id);
    expect(state.portals).toHaveLength(1);
  });
});

describe("ensureWebhookEndpoint", () => {
  it("creates a webhook with the configured event list and returns the secret", async () => {
    const state: MockState = { products: [], prices: [], portals: [], webhooks: [] };
    const client = makeClient("sk_test_x", { fetchImpl: makeMockFetch(state) });

    const wh = await ensureWebhookEndpoint(client, "https://example.com/webhooks/stripe");
    expect(wh.id).toMatch(/^we_/);
    expect(wh.url).toBe("https://example.com/webhooks/stripe");
    expect(wh.enabled_events).toContain("checkout.session.completed");
    expect(wh.enabled_events).toContain("customer.subscription.deleted");
    expect(wh.secret).toMatch(/^whsec_/);
  });

  it("is idempotent — reuses the webhook with the same URL", async () => {
    const state: MockState = { products: [], prices: [], portals: [], webhooks: [] };
    const client = makeClient("sk_test_x", { fetchImpl: makeMockFetch(state) });

    const first = await ensureWebhookEndpoint(client, "https://example.com/webhooks/stripe");
    const second = await ensureWebhookEndpoint(client, "https://example.com/webhooks/stripe");
    expect(second.id).toBe(first.id);
    expect(state.webhooks).toHaveLength(1);
  });
});

describe("makeClient", () => {
  it("dry-run blocks writes and returns a stub id without calling fetch", async () => {
    const fetchSpy = vi.fn();
    const client = makeClient("sk_test_x", { dryRun: true, fetchImpl: fetchSpy });
    const result = await client.request("POST", "/products", { name: "x" });
    expect((result as { id: string }).id).toMatch(/^dryrun_/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dry-run still allows GETs to flow to fetch (so we can list existing resources)", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ data: [], has_more: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = makeClient("sk_test_x", { dryRun: true, fetchImpl: fetchSpy });
    await client.request("GET", "/products");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("throws on non-2xx responses", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("api key invalid", { status: 401 });
    const client = makeClient("sk_test_bad", { fetchImpl });
    await expect(client.request("GET", "/products")).rejects.toThrow(/HTTP 401/);
  });
});
