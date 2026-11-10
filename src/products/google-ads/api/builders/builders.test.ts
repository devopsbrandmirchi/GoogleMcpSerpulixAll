import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkMutateOperations } from "@/products/google-ads/api/write-policy";
import { buildAsset, createAssetSchema, MAX_IMAGE_BYTES } from "./assets";
import { buildDemandGenCampaign, demandGenCampaignSchema } from "./demand-gen";
import {
  addKeywordsSchema,
  buildAdGroup,
  buildKeywords,
  buildResponsiveSearchAd,
  buildSetStatus,
  buildUpdateBudget,
  createAdGroupSchema,
  createResponsiveSearchAdSchema,
  setStatusSchema,
  updateBudgetSchema,
} from "./entities";
import { buildTargeting, setTargetingSchema } from "./targeting";

const C = "1234567890";
const base = { customerId: C };

beforeEach(() => {
  vi.stubEnv("GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS", "10000000");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Demand Gen builder", () => {
  const input = demandGenCampaignSchema.parse({
    ...base,
    name: "YT test",
    dailyBudgetMicros: "5000000",
    containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    locationIds: ["2356"],
    ad: {
      finalUrl: "https://example.com",
      businessName: "Example",
      headlines: ["Headline"],
      longHeadlines: ["Long headline"],
      descriptions: ["Description"],
      youtubeVideoIds: ["dQw4w9WgXcQ"],
      logoImageAssetIds: ["777"],
    },
  });

  it("creates budget, paused campaign, YouTube ad group, targeting, video asset and ad atomically", () => {
    const ops = buildDemandGenCampaign(C, input);
    expect(ops.map((op) => Object.keys(op)[0])).toEqual([
      "campaignBudgetOperation", "campaignOperation", "adGroupOperation",
      "adGroupCriterionOperation", "assetOperation", "adGroupAdOperation",
    ]);
    expect(ops[1]!.campaignOperation!.create).toMatchObject({
      status: "PAUSED", advertisingChannelType: "DEMAND_GEN", maximizeConversions: {},
      campaignBudget: `customers/${C}/campaignBudgets/-1`,
    });
    expect(ops[2]!.adGroupOperation!.create).toMatchObject({
      demandGenAdGroupSettings: { channelControls: { selectedChannels: {
        youtubeInStream: true, youtubeInFeed: true, youtubeShorts: true, display: false,
      } } },
    });
    expect(ops[4]!.assetOperation!.create).toMatchObject({ youtubeVideoAsset: { youtubeVideoId: "dQw4w9WgXcQ" } });
    expect(ops[5]!.adGroupAdOperation!.create).toMatchObject({ ad: { demandGenVideoResponsiveAd: {
      businessName: { text: "Example" },
      videos: [{ asset: `customers/${C}/assets/-4` }],
      logoImages: [{ asset: `customers/${C}/assets/777` }],
    } } });
    expect(() => checkMutateOperations(C, ops)).not.toThrow();
  });

  it("maps bidding strategies", () => {
    const ops = buildDemandGenCampaign(C, { ...input, bidding: { strategy: "TARGET_CPC", targetCpcMicros: "500000" } });
    expect(ops[1]!.campaignOperation!.create).toMatchObject({ targetCpc: { targetCpcMicros: "500000" } });
  });

  it("requires a channel and a video", () => {
    expect(() => demandGenCampaignSchema.parse({ ...input, channels: {
      youtubeInStream: false, youtubeInFeed: false, youtubeShorts: false,
    } })).toThrow();
    expect(() => demandGenCampaignSchema.parse({ ...input, ad: { ...input.ad, youtubeVideoIds: [] } })).toThrow();
  });
});

describe("asset builder", () => {
  it("builds text and YouTube assets", async () => {
    const text = await buildAsset(C, createAssetSchema.parse({ ...base, asset: { type: "TEXT", text: "Hi" } }));
    expect(text[0]!.assetOperation!.create).toMatchObject({ textAsset: { text: "Hi" } });
    const video = await buildAsset(C, createAssetSchema.parse({
      ...base, asset: { type: "YOUTUBE_VIDEO", youtubeVideoId: "dQw4w9WgXcQ" },
    }));
    expect(video[0]!.assetOperation!.create).toMatchObject({ youtubeVideoAsset: { youtubeVideoId: "dQw4w9WgXcQ" } });
  });

  it("downloads images without following redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from("png"), {
      headers: { "content-type": "image/png" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const ops = await buildAsset(C, createAssetSchema.parse({
      ...base, asset: { type: "IMAGE", imageUrl: "https://cdn.example.com/logo.png", name: "Logo" },
    }));
    expect(ops[0]!.assetOperation!.create).toMatchObject({ type: "IMAGE", imageAsset: { data: Buffer.from("png").toString("base64") } });
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
  });

  it.each([
    "https://localhost/logo.png",
    "https://127.0.0.1/logo.png",
    "https://metadata.google.internal/logo.png",
    "https://[::1]/logo.png",
  ])("refuses non-public image host %s", async (imageUrl) => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(buildAsset(C, createAssetSchema.parse({
      ...base, asset: { type: "IMAGE", imageUrl, name: "Logo" },
    }))).rejects.toThrow("public https");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses non-images and oversized images", async () => {
    const parse = () => createAssetSchema.parse({
      ...base, asset: { type: "IMAGE", imageUrl: "https://cdn.example.com/x", name: "X" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { headers: { "content-type": "text/html" } })));
    await expect(buildAsset(C, parse())).rejects.toThrow("PNG");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", {
      headers: { "content-type": "image/png", "content-length": String(MAX_IMAGE_BYTES + 1) },
    })));
    await expect(buildAsset(C, parse())).rejects.toThrow("5 MB");
  });
});

describe("entity builders", () => {
  it("creates paused ad groups by default", () => {
    const ops = buildAdGroup(C, createAdGroupSchema.parse({ ...base, campaignId: "5", name: "AG", cpcBidMicros: "100000" }));
    expect(ops[0]!.adGroupOperation!.create).toEqual({
      name: "AG", campaign: `customers/${C}/campaigns/5`, type: "SEARCH_STANDARD", status: "PAUSED", cpcBidMicros: "100000",
    });
  });

  it("adds positive, ad group negative and campaign negative keywords", () => {
    const keywords = [{ text: "shoes", matchType: "PHRASE" as const }];
    const positive = buildKeywords(C, addKeywordsSchema.parse({ ...base, adGroupId: "7", keywords }));
    expect(positive[0]!.adGroupCriterionOperation!.create).toMatchObject({ status: "ENABLED", keyword: { text: "shoes", matchType: "PHRASE" } });
    const negative = buildKeywords(C, addKeywordsSchema.parse({ ...base, adGroupId: "7", negative: true, keywords }));
    expect(negative[0]!.adGroupCriterionOperation!.create).toMatchObject({ negative: true });
    const campaign = buildKeywords(C, addKeywordsSchema.parse({ ...base, campaignId: "5", negative: true, keywords }));
    expect(campaign[0]!.campaignCriterionOperation!.create).toMatchObject({ campaign: `customers/${C}/campaigns/5`, negative: true });
    expect(() => addKeywordsSchema.parse({ ...base, campaignId: "5", keywords })).toThrow();
    expect(() => addKeywordsSchema.parse({ ...base, campaignId: "5", adGroupId: "7", negative: true, keywords })).toThrow();
  });

  it("builds responsive search ads with limits", () => {
    const input = {
      ...base, adGroupId: "7", finalUrls: ["https://example.com"],
      headlines: [{ text: "One" }, { text: "Two" }, { text: "Three", pinnedField: "HEADLINE_1" }],
      descriptions: [{ text: "First" }, { text: "Second" }],
      path1: "shoes",
    };
    const ops = buildResponsiveSearchAd(C, createResponsiveSearchAdSchema.parse(input));
    expect(ops[0]!.adGroupAdOperation!.create).toMatchObject({
      status: "PAUSED", ad: { responsiveSearchAd: { path1: "shoes", headlines: input.headlines } },
    });
    expect(() => createResponsiveSearchAdSchema.parse({ ...input, headlines: input.headlines.slice(0, 2) })).toThrow();
    expect(() => createResponsiveSearchAdSchema.parse({ ...input, headlines: [...input.headlines, { text: "x".repeat(31) }] })).toThrow();
  });

  it("sets status with the right resource names and only ENABLED or PAUSED", () => {
    const ops = buildSetStatus(C, setStatusSchema.parse({ ...base, entityType: "AD", ids: ["7~9"], status: "ENABLED" }));
    expect(ops[0]).toEqual({ adGroupAdOperation: {
      update: { resourceName: `customers/${C}/adGroupAds/7~9`, status: "ENABLED" }, updateMask: "status",
    } });
    expect(() => setStatusSchema.parse({ ...base, entityType: "AD", ids: ["9"], status: "PAUSED" })).toThrow();
    expect(() => setStatusSchema.parse({ ...base, entityType: "CAMPAIGN", ids: ["9"], status: "REMOVED" })).toThrow();
  });

  it("updates budgets with a matching field mask and the cap", () => {
    const ops = buildUpdateBudget(C, updateBudgetSchema.parse({ ...base, budgetId: "3", amountMicros: "2000000" }));
    expect(ops[0]).toEqual({ campaignBudgetOperation: {
      update: { resourceName: `customers/${C}/campaignBudgets/3`, amountMicros: "2000000" }, updateMask: "amountMicros",
    } });
    const tooHigh = buildUpdateBudget(C, updateBudgetSchema.parse({ ...base, budgetId: "3", amountMicros: "20000000" }));
    expect(() => checkMutateOperations(C, tooHigh)).toThrow("exceeds");
  });
});

describe("targeting builder", () => {
  it("adds campaign criteria and removes criteria by ID", () => {
    const ops = buildTargeting(C, setTargetingSchema.parse({
      ...base,
      campaignId: "5",
      add: [
        { type: "LOCATION", geoTargetConstantId: "2356" },
        { type: "LANGUAGE", languageConstantId: "1000" },
        { type: "DEVICE", device: "MOBILE", bidModifier: 1.2 },
        { type: "AD_SCHEDULE", dayOfWeek: "MONDAY", startHour: 9, endHour: 17, endMinute: 30 },
      ],
      removeCriterionIds: ["42"],
    }));
    expect(ops.map((op) => op.campaignCriterionOperation)).toEqual([
      { create: { campaign: `customers/${C}/campaigns/5`, location: { geoTargetConstant: "geoTargetConstants/2356" } } },
      { create: { campaign: `customers/${C}/campaigns/5`, language: { languageConstant: "languageConstants/1000" } } },
      { create: { campaign: `customers/${C}/campaigns/5`, bidModifier: 1.2, device: { type: "MOBILE" } } },
      { create: { campaign: `customers/${C}/campaigns/5`, adSchedule: {
        dayOfWeek: "MONDAY", startHour: 9, startMinute: "ZERO", endHour: 17, endMinute: "THIRTY",
      } } },
      { remove: `customers/${C}/campaignCriteria/5~42` },
    ]);
    expect(() => checkMutateOperations(C, ops)).not.toThrow();
  });

  it("adds ad group audiences and demographics and rejects campaign-only criteria", () => {
    const ops = buildTargeting(C, setTargetingSchema.parse({
      ...base,
      adGroupId: "7",
      add: [
        { type: "AUDIENCE", userListId: "88" },
        { type: "AGE_RANGE", ageRange: "AGE_RANGE_18_24", negative: true },
        { type: "GENDER", gender: "FEMALE" },
      ],
    }));
    expect(ops[0]!.adGroupCriterionOperation!.create).toMatchObject({ userList: { userList: `customers/${C}/userLists/88` } });
    expect(ops[1]!.adGroupCriterionOperation!.create).toMatchObject({ negative: true, ageRange: { type: "AGE_RANGE_18_24" } });
    expect(() => setTargetingSchema.parse({
      ...base, adGroupId: "7", add: [{ type: "DEVICE", device: "MOBILE", bidModifier: 1 }],
    })).toThrow();
  });
});
