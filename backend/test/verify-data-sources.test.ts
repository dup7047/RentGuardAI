/**
 * Unit tests for the Phase 0.3 data-source verifier. The actual live HTTP
 * test is the script itself — these tests validate the script's structure,
 * inventory completeness, and behavior on mocked HTTP responses.
 */

import { describe, expect, it } from "vitest";
import { ENDPOINTS, checkEndpoint, type Endpoint } from "../scripts/verify-data-sources.js";

describe("data-source endpoint inventory", () => {
  it("has every dataset listed in the Phase 0.3 roadmap", () => {
    // Sanity check: 8 datasets per the roadmap (HPD Violations, HPD
    // Registrations, HPD Registration Contacts, DOB Complaints, 311 Housing
    // Complaints, NYC Marshal Evictions, Bedbug Registry, Lead Paint History).
    expect(ENDPOINTS).toHaveLength(8);
    const ids = ENDPOINTS.map((e) => e.resourceId);
    expect(ids).toContain("wvxf-dwi5"); // HPD Violations
    expect(ids).toContain("tesw-yqqr"); // HPD Multiple Dwelling Registrations
    expect(ids).toContain("feu5-w2e2"); // HPD Registration Contacts
    expect(ids).toContain("eabe-havv"); // DOB Complaints
    expect(ids).toContain("erm2-nwe9"); // 311 Service Requests
    expect(ids).toContain("6z8x-wfk4"); // Marshal Evictions
    expect(ids).toContain("wz6d-d3jb"); // Bedbug Reporting
    expect(ids).toContain("au8t-hgv2"); // Lead Paint Violations
  });

  it("every endpoint has a non-empty primary key", () => {
    for (const ep of ENDPOINTS) {
      expect(ep.primaryKey, `${ep.resourceId} primaryKey`).toBeTruthy();
      expect(ep.primaryKey.length, `${ep.resourceId} primaryKey length`).toBeGreaterThan(0);
    }
  });

  it("resource IDs match the Socrata 4x4 format", () => {
    for (const ep of ENDPOINTS) {
      expect(ep.resourceId).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
    }
  });
});

describe("checkEndpoint", () => {
  function mockFetch(rows: Array<Record<string, unknown>>, status = 200): typeof fetch {
    return async () =>
      new Response(JSON.stringify(rows), {
        status,
        headers: { "Content-Type": "application/json" },
      });
  }

  const sample: Endpoint = {
    label: "test dataset",
    resourceId: "abcd-1234",
    primaryKey: "violationid",
  };

  it("passes when the documented primary key is present", async () => {
    const r = await checkEndpoint(
      sample,
      undefined,
      mockFetch([{ violationid: "1", buildingid: "100" }]),
    );
    expect(r.status).toBe("pass");
    expect(r.matchedKey).toBe("violationid");
    expect(r.httpStatus).toBe(200);
  });

  it("falls back to alternate primary keys", async () => {
    const ep: Endpoint = { ...sample, alternatePrimaryKeys: [":id"] };
    const r = await checkEndpoint(ep, undefined, mockFetch([{ ":id": "row1", other: "x" }]));
    expect(r.status).toBe("pass");
    expect(r.matchedKey).toBe(":id");
  });

  it("fails when no documented key is present", async () => {
    const r = await checkEndpoint(sample, undefined, mockFetch([{ unrelated: "x" }]));
    expect(r.status).toBe("fail");
    expect(r.error).toContain("none of [violationid]");
  });

  it("fails on non-200 HTTP status", async () => {
    const r = await checkEndpoint(sample, undefined, mockFetch([], 500));
    expect(r.status).toBe("fail");
    expect(r.httpStatus).toBe(500);
  });

  it("fails on empty array (dataset returned no rows)", async () => {
    const r = await checkEndpoint(sample, undefined, mockFetch([]));
    expect(r.status).toBe("fail");
    expect(r.error).toContain("empty array");
  });

  it("fails on network error", async () => {
    const r = await checkEndpoint(sample, undefined, async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(r.status).toBe("fail");
    expect(r.httpStatus).toBeNull();
    expect(r.error).toContain("ECONNREFUSED");
  });

  it("includes X-App-Token header when token is provided", async () => {
    let receivedHeaders: Headers | undefined;
    const r = await checkEndpoint(sample, "test-token-xyz", async (_url, init) => {
      receivedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify([{ violationid: "1" }]), { status: 200 });
    });
    expect(r.status).toBe("pass");
    expect(receivedHeaders?.get("X-App-Token")).toBe("test-token-xyz");
  });

  it("omits X-App-Token header when token is undefined", async () => {
    let receivedHeaders: Headers | undefined;
    await checkEndpoint(sample, undefined, async (_url, init) => {
      receivedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify([{ violationid: "1" }]), { status: 200 });
    });
    expect(receivedHeaders?.get("X-App-Token")).toBeNull();
  });
});
