import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createSearchCampaign } from "./create-campaign";
import { resolveAdsAccessContext } from "@/products/google-ads/routing";
import { adsRequest } from "./client";

vi.mock("@/products/google-ads/routing", () => ({ resolveAdsAccessContext: vi.fn() }));
vi.mock("./client", () => ({ adsRequest: vi.fn(), requireAccessToken: (token: string) => token }));

const input = {
  customerId: "123-456-7890", name: "Connector test", dailyBudgetMicros: "1000000",
  containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING" as const,
};

beforeEach(() => {
  vi.stubEnv("GOOGLE_ADS_WRITES_ENABLED", "true");
  vi.stubEnv("GOOGLE_ADS_WRITE_CUSTOMER_IDS", "1234567890");
  vi.stubEnv("GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS", "10000000");
  vi.mocked(resolveAdsAccessContext).mockResolvedValue({
    customerId: "1234567890", loginCustomerId: "9999999999", isManager: false,
    client: { getAccessToken: async () => ({ token: "token" }) },
  } as unknown as Awaited<ReturnType<typeof resolveAdsAccessContext>>);
  vi.mocked(adsRequest).mockResolvedValue({ status: 200, body: {}, requestId: "request" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("campaign creation", () => {
  it("defaults to validation and atomically links a paused campaign to its budget", async () => {
    expect(await createSearchCampaign(input)).toMatchObject({ validated: true, created: false });
    expect(resolveAdsAccessContext).toHaveBeenCalledWith("1234567890", undefined);
    const request = vi.mocked(adsRequest).mock.calls[0]![0];
    expect(request).toMatchObject({ path: "/customers/1234567890/googleAds:mutate", loginCustomerId: "9999999999" });
    expect(request.body).toMatchObject({ validateOnly: true, partialFailure: false,
      mutateOperations: [
        { campaignBudgetOperation: { create: { resourceName: "customers/1234567890/campaignBudgets/-1", amountMicros: "1000000", explicitlyShared: false } } },
        { campaignOperation: { create: { campaignBudget: "customers/1234567890/campaignBudgets/-1", status: "PAUSED", advertisingChannelType: "SEARCH" } } },
      ],
    });
  });
  it.each([
    ["GOOGLE_ADS_WRITES_ENABLED", "false"],
    ["GOOGLE_ADS_WRITE_CUSTOMER_IDS", "9876543210"],
    ["GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS", "999999"],
    ["GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS", "invalid"],
  ])("blocks writes with %s=%s before resolving credentials", async (key, value) => {
    vi.stubEnv(key, value);
    await expect(createSearchCampaign(input)).rejects.toThrow();
    expect(resolveAdsAccessContext).not.toHaveBeenCalled();
    expect(adsRequest).not.toHaveBeenCalled();
  });
  it("requires confirmation for execution", async () => {
    await expect(createSearchCampaign({ ...input, validateOnly: false })).rejects.toThrow("approval");
    expect(adsRequest).not.toHaveBeenCalled();
  });
  it("executes only with explicit confirmation", async () => {
    expect(await createSearchCampaign({ ...input, validateOnly: false, confirm: true })).toMatchObject({ created: true, validated: false });
    expect(vi.mocked(adsRequest).mock.calls[0]![0].body).toMatchObject({ validateOnly: false });
  });
  it("rejects manager accounts", async () => {
    vi.mocked(resolveAdsAccessContext).mockResolvedValue({ isManager: true } as Awaited<ReturnType<typeof resolveAdsAccessContext>>);
    await expect(createSearchCampaign(input)).rejects.toThrow("client account");
    expect(adsRequest).not.toHaveBeenCalled();
  });
  it("preserves ownership failures without making a mutation", async () => {
    vi.mocked(resolveAdsAccessContext).mockRejectedValue(new Error("not owned"));
    await expect(createSearchCampaign(input)).rejects.toThrow("not owned");
    expect(adsRequest).not.toHaveBeenCalled();
  });
  it("does not retry a failed mutation", async () => {
    vi.mocked(adsRequest).mockRejectedValue(new Error("timeout"));
    await expect(createSearchCampaign({ ...input, validateOnly: false, confirm: true })).rejects.toThrow("timeout");
    expect(adsRequest).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid budgets and missing political declaration", async () => {
    await expect(createSearchCampaign({ ...input, dailyBudgetMicros: "-1" })).rejects.toThrow();
    await expect(createSearchCampaign({ ...input, containsEuPoliticalAdvertising: undefined } as unknown as typeof input)).rejects.toThrow();
    expect(adsRequest).not.toHaveBeenCalled();
  });
});
