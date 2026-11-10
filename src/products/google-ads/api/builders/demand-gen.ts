import { z } from "zod";
import type { MutateOperation } from "@/products/google-ads/api/write-policy";
import {
  euPoliticalSchema,
  microsSchema,
  numericIdSchema,
  resourceName,
  textAssets,
  writeBaseShape,
} from "@/products/google-ads/api/builders/common";
import { youtubeVideoIdSchema } from "@/products/google-ads/api/builders/assets";

const biddingSchema = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("MAXIMIZE_CONVERSIONS"), targetCpaMicros: microsSchema.optional() }),
  z.object({ strategy: z.literal("TARGET_CPA"), targetCpaMicros: microsSchema }),
  z.object({ strategy: z.literal("MAXIMIZE_CLICKS") }),
  z.object({ strategy: z.literal("TARGET_CPC"), targetCpcMicros: microsSchema }),
]);

const channelsSchema = z
  .object({
    youtubeInStream: z.boolean().default(true),
    youtubeInFeed: z.boolean().default(true),
    youtubeShorts: z.boolean().default(true),
    discover: z.boolean().default(false),
    gmail: z.boolean().default(false),
    display: z.boolean().default(false),
    maps: z.boolean().default(false),
  })
  .refine((channels) => Object.values(channels).some(Boolean), {
    message: "Select at least one channel.",
  });

const videoAdSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    finalUrl: z.url({ protocol: /^https?$/ }),
    businessName: z.string().trim().min(1).max(25),
    headlines: z.array(z.string().trim().min(1).max(40)).min(1).max(5),
    longHeadlines: z.array(z.string().trim().min(1).max(90)).min(1).max(5),
    descriptions: z.array(z.string().trim().min(1).max(90)).min(1).max(5),
    youtubeVideoIds: z.array(youtubeVideoIdSchema).max(5).default([]),
    videoAssetIds: z.array(numericIdSchema).max(5).default([]),
    logoImageAssetIds: z.array(numericIdSchema).min(1).max(5),
  })
  .refine((ad) => ad.youtubeVideoIds.length + ad.videoAssetIds.length > 0, {
    message: "Provide at least one youtubeVideoIds or videoAssetIds entry.",
  });

export const demandGenCampaignSchema = z.object({
  ...writeBaseShape,
  name: z.string().trim().min(1).max(128),
  dailyBudgetMicros: microsSchema,
  containsEuPoliticalAdvertising: euPoliticalSchema,
  bidding: biddingSchema.default({ strategy: "MAXIMIZE_CONVERSIONS" }),
  adGroupName: z.string().trim().min(1).max(255).optional(),
  channels: channelsSchema.default({
    youtubeInStream: true,
    youtubeInFeed: true,
    youtubeShorts: true,
    discover: false,
    gmail: false,
    display: false,
    maps: false,
  }),
  locationIds: z.array(numericIdSchema).max(50).default([]),
  languageIds: z.array(numericIdSchema).max(20).default([]),
  ad: videoAdSchema.optional(),
});

export type DemandGenCampaignInput = z.output<typeof demandGenCampaignSchema>;

function biddingFields(bidding: DemandGenCampaignInput["bidding"]): Record<string, unknown> {
  switch (bidding.strategy) {
    case "MAXIMIZE_CONVERSIONS":
      return { maximizeConversions: bidding.targetCpaMicros ? { targetCpaMicros: bidding.targetCpaMicros } : {} };
    case "TARGET_CPA":
      return { targetCpa: { targetCpaMicros: bidding.targetCpaMicros } };
    case "MAXIMIZE_CLICKS":
      return { targetSpend: {} };
    case "TARGET_CPC":
      return { targetCpc: { targetCpcMicros: bidding.targetCpcMicros } };
  }
}

// Temporary negative IDs let later operations reference resources created earlier in the same request.
export function buildDemandGenCampaign(customerId: string, input: DemandGenCampaignInput): MutateOperation[] {
  const budget = resourceName(customerId, "campaignBudgets", -1);
  const campaign = resourceName(customerId, "campaigns", -2);
  const adGroup = resourceName(customerId, "adGroups", -3);
  let nextTempId = -4;

  const operations: MutateOperation[] = [
    { campaignBudgetOperation: { create: {
      resourceName: budget,
      name: `${input.name} budget`,
      amountMicros: input.dailyBudgetMicros,
      deliveryMethod: "STANDARD",
      explicitlyShared: false,
    } } },
    { campaignOperation: { create: {
      resourceName: campaign,
      name: input.name,
      status: "PAUSED",
      advertisingChannelType: "DEMAND_GEN",
      campaignBudget: budget,
      containsEuPoliticalAdvertising: input.containsEuPoliticalAdvertising,
      ...biddingFields(input.bidding),
    } } },
    { adGroupOperation: { create: {
      resourceName: adGroup,
      name: input.adGroupName ?? `${input.name} ad group`,
      campaign,
      status: "ENABLED",
      demandGenAdGroupSettings: { channelControls: { selectedChannels: input.channels } },
    } } },
  ];

  for (const id of input.locationIds) {
    operations.push({ adGroupCriterionOperation: { create: {
      adGroup,
      location: { geoTargetConstant: `geoTargetConstants/${id}` },
    } } });
  }
  for (const id of input.languageIds) {
    operations.push({ adGroupCriterionOperation: { create: {
      adGroup,
      language: { languageConstant: `languageConstants/${id}` },
    } } });
  }

  if (input.ad) {
    const videos = input.ad.videoAssetIds.map((id) => ({ asset: resourceName(customerId, "assets", id) }));
    for (const youtubeVideoId of input.ad.youtubeVideoIds) {
      const asset = resourceName(customerId, "assets", nextTempId--);
      operations.push({ assetOperation: { create: {
        resourceName: asset,
        youtubeVideoAsset: { youtubeVideoId },
      } } });
      videos.push({ asset });
    }
    operations.push({ adGroupAdOperation: { create: {
      adGroup,
      status: "ENABLED",
      ad: {
        name: input.ad.name ?? `${input.name} video ad`,
        finalUrls: [input.ad.finalUrl],
        demandGenVideoResponsiveAd: {
          businessName: { text: input.ad.businessName },
          videos,
          logoImages: input.ad.logoImageAssetIds.map((id) => ({ asset: resourceName(customerId, "assets", id) })),
          headlines: textAssets(input.ad.headlines),
          longHeadlines: textAssets(input.ad.longHeadlines),
          descriptions: textAssets(input.ad.descriptions),
        },
      },
    } } });
  }

  return operations;
}
