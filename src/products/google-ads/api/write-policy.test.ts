import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertWriteAllowed, checkMutateOperations } from "./write-policy";

const C = "1234567890";
const rn = (path: string) => `customers/${C}/${path}`;

beforeEach(() => {
  vi.stubEnv("GOOGLE_ADS_WRITES_ENABLED", "true");
  vi.stubEnv("GOOGLE_ADS_WRITE_CUSTOMER_IDS", C);
  vi.stubEnv("GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS", "10000000");
  vi.stubEnv("GOOGLE_ADS_MAX_TOTAL_BUDGET_MICROS", "");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("assertWriteAllowed", () => {
  it("normalizes allowed customers", () => {
    expect(assertWriteAllowed("123-456-7890")).toBe(C);
  });
  it.each([
    ["GOOGLE_ADS_WRITES_ENABLED", "false"],
    ["GOOGLE_ADS_WRITE_CUSTOMER_IDS", ""],
    ["GOOGLE_ADS_WRITE_CUSTOMER_IDS", "9876543210"],
    ["GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS", ""],
  ])("blocks with %s=%s", (key, value) => {
    vi.stubEnv(key, value);
    expect(() => assertWriteAllowed(C)).toThrow();
  });
  it("accepts the wildcard", () => {
    vi.stubEnv("GOOGLE_ADS_WRITE_CUSTOMER_IDS", "*");
    expect(assertWriteAllowed("5555555555")).toBe("5555555555");
  });
});

describe("checkMutateOperations", () => {
  it.each([
    "campaignBudgetOperation", "campaignOperation", "adGroupOperation", "adGroupAdOperation",
    "assetOperation", "assetGroupOperation", "biddingStrategyOperation", "sharedSetOperation",
    "labelOperation", "conversionActionOperation", "unknownThingOperation",
  ])("blocks removes via %s", (type) => {
    expect(() => checkMutateOperations(C, [{ [type]: { remove: rn("x/1") } }])).toThrow("Pause it instead");
  });

  it("allows detaching links and criteria and records ad group criteria for lookup", () => {
    const checked = checkMutateOperations(C, [
      { campaignCriterionOperation: { remove: rn("campaignCriteria/1~2") } },
      { adGroupCriterionOperation: { remove: rn("adGroupCriteria/3~4") } },
      { campaignAssetOperation: { remove: rn("campaignAssets/1~2~SITELINK") } },
      { campaignSharedSetOperation: { remove: rn("campaignSharedSets/1~2") } },
    ]);
    expect(checked.summary.map((item) => item.action)).toEqual(["remove", "remove", "remove", "remove"]);
    expect(checked.adGroupCriterionRemovals).toEqual([rn("adGroupCriteria/3~4")]);
  });

  it("blocks status REMOVED anywhere in a create or update", () => {
    expect(() => checkMutateOperations(C, [
      { adGroupOperation: { update: { resourceName: rn("adGroups/1"), status: "REMOVED" }, updateMask: "status" } },
    ])).toThrow("REMOVED");
    expect(() => checkMutateOperations(C, [
      { adGroupAdOperation: { create: { adGroup: rn("adGroups/1"), status: "REMOVED", ad: {} } } },
    ])).toThrow("REMOVED");
  });

  it("forces new campaigns to PAUSED and rejects ENABLED", () => {
    const checked = checkMutateOperations(C, [{ campaignOperation: { create: { name: "x" } } }]);
    expect(checked.operations[0]).toEqual({ campaignOperation: { create: { name: "x", status: "PAUSED" } } });
    expect(() => checkMutateOperations(C, [
      { campaignOperation: { create: { name: "x", status: "ENABLED" } } },
    ])).toThrow("PAUSED");
  });

  it("allows enabling an existing campaign with an update", () => {
    const checked = checkMutateOperations(C, [
      { campaignOperation: { update: { resourceName: rn("campaigns/1"), status: "ENABLED" }, updateMask: "status" } },
    ]);
    expect(checked.summary[0]).toMatchObject({ action: "update", resourceName: rn("campaigns/1") });
  });

  it("enforces the daily budget cap on create and update", () => {
    expect(() => checkMutateOperations(C, [
      { campaignBudgetOperation: { create: { amountMicros: "10000001" } } },
    ])).toThrow("exceeds");
    expect(() => checkMutateOperations(C, [
      { campaignBudgetOperation: { update: { resourceName: rn("campaignBudgets/1"), amountMicros: 20000000 }, updateMask: "amountMicros" } },
    ])).toThrow("exceeds");
    expect(() => checkMutateOperations(C, [
      { campaignBudgetOperation: { create: { amountMicros: "10000000" } } },
    ])).not.toThrow();
  });

  it("blocks total budgets unless a total cap is configured", () => {
    const op = [{ campaignBudgetOperation: { create: { totalAmountMicros: "50000000" } } }];
    expect(() => checkMutateOperations(C, op)).toThrow("GOOGLE_ADS_MAX_TOTAL_BUDGET_MICROS");
    vi.stubEnv("GOOGLE_ADS_MAX_TOTAL_BUDGET_MICROS", "40000000");
    expect(() => checkMutateOperations(C, op)).toThrow("exceeds");
    vi.stubEnv("GOOGLE_ADS_MAX_TOTAL_BUDGET_MICROS", "50000000");
    expect(() => checkMutateOperations(C, op)).not.toThrow();
  });

  it("rejects resources from another customer", () => {
    expect(() => checkMutateOperations(C, [
      { adGroupOperation: { create: { campaign: "customers/9999999999/campaigns/1" } } },
    ])).toThrow("different customer");
    expect(() => checkMutateOperations(C, [
      { campaignCriterionOperation: { remove: "customers/9999999999/campaignCriteria/1~2" } },
    ])).toThrow();
  });

  it.each([
    [[]],
    [[{}]],
    [[{ campaignOperation: {} }]],
    [[{ campaignOperation: { create: {}, update: {} } }]],
    [[{ campaignOperation: { create: {} }, adGroupOperation: { create: {} } }]],
    [[{ campaign: { create: {} } }]],
    [[{ campaignOperation: { update: { resourceName: rn("campaigns/1") } } }]],
    [[{ adGroupCriterionOperation: { remove: rn("adGroupCriteria/bad") } }]],
    [Array.from({ length: 101 }, () => ({ labelOperation: { create: { name: "x" } } }))],
  ])("rejects malformed operations %#", (operations) => {
    expect(() => checkMutateOperations(C, operations)).toThrow();
  });
});
