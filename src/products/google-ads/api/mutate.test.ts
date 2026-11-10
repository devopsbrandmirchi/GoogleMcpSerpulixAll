import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeGuardedMutate } from "./mutate";
import { resolveAdsAccessContext } from "@/products/google-ads/routing";
import { adsRequest, searchGoogleAds } from "./client";

vi.mock("@/products/google-ads/routing", () => ({ resolveAdsAccessContext: vi.fn() }));
vi.mock("./client", () => ({
  adsRequest: vi.fn(),
  searchGoogleAds: vi.fn(),
  requireAccessToken: (token: string) => token,
}));

const C = "1234567890";
const criterion = `customers/${C}/adGroupCriteria/11~22`;
const base = { customerId: C, validateOnly: true, confirm: false };

function lookupReturns(type: string, negative: boolean) {
  vi.mocked(searchGoogleAds).mockResolvedValue({
    results: [{ adGroupCriterion: { resourceName: criterion, type, negative } }],
    requestId: "lookup",
  });
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_ADS_WRITES_ENABLED", "true");
  vi.stubEnv("GOOGLE_ADS_WRITE_CUSTOMER_IDS", C);
  vi.stubEnv("GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS", "10000000");
  vi.mocked(resolveAdsAccessContext).mockResolvedValue({
    customerId: C, loginCustomerId: "9999999999", isManager: false, googleEmail: "a@example.com",
    client: { getAccessToken: async () => ({ token: "token" }) },
  } as unknown as Awaited<ReturnType<typeof resolveAdsAccessContext>>);
  vi.mocked(adsRequest).mockResolvedValue({ status: 200, body: { mutateOperationResponses: [] }, requestId: "req" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("executeGuardedMutate", () => {
  it("sends one atomic validate-only mutate with the login customer", async () => {
    const result = await executeGuardedMutate({
      ...base,
      operations: [{ labelOperation: { create: { name: "Test" } } }],
    });
    expect(result).toMatchObject({ validated: true, executed: false, requestId: "req" });
    expect(adsRequest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(adsRequest).mock.calls[0]![0]).toMatchObject({
      path: `/customers/${C}/googleAds:mutate`,
      loginCustomerId: "9999999999",
      body: { validateOnly: true, partialFailure: false, responseContentType: "MUTABLE_RESOURCE" },
    });
  });

  it("blocks removing a positive keyword after the lookup", async () => {
    lookupReturns("KEYWORD", false);
    await expect(executeGuardedMutate({
      ...base,
      operations: [{ adGroupCriterionOperation: { remove: criterion } }],
    })).rejects.toThrow("keyword");
    expect(adsRequest).not.toHaveBeenCalled();
  });

  it.each([["KEYWORD", true], ["LOCATION", false], ["USER_LIST", false]])(
    "allows removing a %s criterion (negative=%s)",
    async (type, negative) => {
      lookupReturns(type, negative);
      await executeGuardedMutate({ ...base, operations: [{ adGroupCriterionOperation: { remove: criterion } }] });
      expect(vi.mocked(searchGoogleAds).mock.calls[0]![0].query).toContain(`'${criterion}'`);
      expect(adsRequest).toHaveBeenCalledTimes(1);
    },
  );

  it("blocks removing a criterion that cannot be found", async () => {
    vi.mocked(searchGoogleAds).mockResolvedValue({ results: [], requestId: "lookup" });
    await expect(executeGuardedMutate({
      ...base,
      operations: [{ adGroupCriterionOperation: { remove: criterion } }],
    })).rejects.toThrow("not found");
    expect(adsRequest).not.toHaveBeenCalled();
  });

  it("requires confirmation before resolving credentials", async () => {
    await expect(executeGuardedMutate({
      ...base,
      validateOnly: false,
      operations: [{ labelOperation: { create: { name: "Test" } } }],
    })).rejects.toThrow("approval");
    expect(resolveAdsAccessContext).not.toHaveBeenCalled();
  });

  it("executes with confirmation and does not retry failures", async () => {
    vi.mocked(adsRequest).mockRejectedValue(new Error("timeout"));
    await expect(executeGuardedMutate({
      ...base,
      validateOnly: false,
      confirm: true,
      operations: [{ labelOperation: { create: { name: "Test" } } }],
    })).rejects.toThrow("timeout");
    expect(adsRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects manager accounts", async () => {
    vi.mocked(resolveAdsAccessContext).mockResolvedValue(
      { isManager: true } as Awaited<ReturnType<typeof resolveAdsAccessContext>>,
    );
    await expect(executeGuardedMutate({
      ...base,
      operations: [{ labelOperation: { create: { name: "Test" } } }],
    })).rejects.toThrow("client account");
    expect(adsRequest).not.toHaveBeenCalled();
  });
});
