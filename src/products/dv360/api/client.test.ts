import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dv360Request,
  listDv360Collection,
  listFilter,
} from "@/products/dv360/api/client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("DV360 client", () => {
  it("passes pageSize and pageToken through to the official list API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        campaigns: [{ campaignId: "1" }],
        nextPageToken: "page-2",
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const page = await listDv360Collection({
      path: "/advertisers/123/campaigns",
      accessToken: "ya29.example",
      itemsKey: "campaigns",
      pageSize: 50,
      pageToken: "page-1",
      filter: 'entityStatus="ENTITY_STATUS_ACTIVE"',
    });

    expect(page.items).toEqual([{ campaignId: "1" }]);
    expect(page.nextPageToken).toBe("page-2");
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("/v4/advertisers/123/campaigns");
    expect(calledUrl).toContain("pageSize=50");
    expect(calledUrl).toContain("pageToken=page-1");
    expect(calledUrl).toContain("entityStatus");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer ya29.example",
    });
  });

  it("maps 403 permission errors to resource_not_accessible", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(403, { error: { message: "The caller does not have permission" } }),
    ) as typeof fetch;

    await expect(
      dv360Request({ path: "/advertisers/9", accessToken: "ya29.example" }),
    ).rejects.toMatchObject({
      code: "resource_not_accessible",
      status: 403,
    });
  });

  it("maps 404 errors to advertiser_not_found", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() =>
      jsonResponse(404, { error: { message: "Requested entity was not found." } }),
    ) as typeof fetch;

    await expect(
      dv360Request({ path: "/advertisers/9", accessToken: "ya29.example" }),
    ).rejects.toMatchObject({
      code: "advertiser_not_found",
      status: 404,
    });
  });

  it("builds an official entityStatus filter when no raw filter is supplied", () => {
    expect(listFilter({ entityStatus: "ENTITY_STATUS_ACTIVE" })).toBe(
      'entityStatus="ENTITY_STATUS_ACTIVE"',
    );
    expect(listFilter({ filter: 'displayName="Acme"', entityStatus: "ENTITY_STATUS_ACTIVE" })).toBe(
      'displayName="Acme"',
    );
  });
});
