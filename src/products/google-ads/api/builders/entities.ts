import { z } from "zod";
import type { MutateOperation } from "@/products/google-ads/api/write-policy";
import {
  compositeIdSchema,
  microsSchema,
  numericIdSchema,
  resourceName,
  statusSchema,
  writeBaseShape,
} from "@/products/google-ads/api/builders/common";

export const createAdGroupSchema = z.object({
  ...writeBaseShape,
  campaignId: numericIdSchema,
  name: z.string().trim().min(1).max(255),
  type: z.enum(["SEARCH_STANDARD", "DISPLAY_STANDARD"]).default("SEARCH_STANDARD"),
  cpcBidMicros: microsSchema.optional(),
  status: statusSchema.default("PAUSED"),
});

export function buildAdGroup(customerId: string, input: z.output<typeof createAdGroupSchema>): MutateOperation[] {
  return [{ adGroupOperation: { create: {
    name: input.name,
    campaign: resourceName(customerId, "campaigns", input.campaignId),
    type: input.type,
    status: input.status,
    ...(input.cpcBidMicros ? { cpcBidMicros: input.cpcBidMicros } : {}),
  } } }];
}

const keywordSchema = z.object({
  text: z.string().trim().min(1).max(80),
  matchType: z.enum(["EXACT", "PHRASE", "BROAD"]),
  cpcBidMicros: microsSchema.optional(),
});

export const addKeywordsSchema = z
  .object({
    ...writeBaseShape,
    adGroupId: numericIdSchema.optional(),
    campaignId: numericIdSchema.optional(),
    negative: z.boolean().default(false),
    keywords: z.array(keywordSchema).min(1).max(100),
  })
  .refine((input) => Boolean(input.adGroupId) !== Boolean(input.campaignId), {
    message: "Provide exactly one of adGroupId or campaignId.",
  })
  .refine((input) => !input.campaignId || input.negative, {
    message: "Campaign-level keywords must be negative. Use adGroupId for positive keywords.",
  });

export function buildKeywords(customerId: string, input: z.output<typeof addKeywordsSchema>): MutateOperation[] {
  return input.keywords.map((keyword): MutateOperation => {
    const info = { text: keyword.text, matchType: keyword.matchType };
    if (input.campaignId) {
      return { campaignCriterionOperation: { create: {
        campaign: resourceName(customerId, "campaigns", input.campaignId),
        negative: true,
        keyword: info,
      } } };
    }
    return { adGroupCriterionOperation: { create: {
      adGroup: resourceName(customerId, "adGroups", input.adGroupId!),
      ...(input.negative
        ? { negative: true }
        : { status: "ENABLED", ...(keyword.cpcBidMicros ? { cpcBidMicros: keyword.cpcBidMicros } : {}) }),
      keyword: info,
    } } };
  });
}

export const createResponsiveSearchAdSchema = z.object({
  ...writeBaseShape,
  adGroupId: numericIdSchema,
  finalUrls: z.array(z.url({ protocol: /^https?$/ })).min(1).max(10),
  headlines: z
    .array(z.object({
      text: z.string().trim().min(1).max(30),
      pinnedField: z.enum(["HEADLINE_1", "HEADLINE_2", "HEADLINE_3"]).optional(),
    }))
    .min(3)
    .max(15),
  descriptions: z
    .array(z.object({
      text: z.string().trim().min(1).max(90),
      pinnedField: z.enum(["DESCRIPTION_1", "DESCRIPTION_2"]).optional(),
    }))
    .min(2)
    .max(4),
  path1: z.string().trim().min(1).max(15).optional(),
  path2: z.string().trim().min(1).max(15).optional(),
  status: statusSchema.default("PAUSED"),
});

export function buildResponsiveSearchAd(
  customerId: string,
  input: z.output<typeof createResponsiveSearchAdSchema>,
): MutateOperation[] {
  return [{ adGroupAdOperation: { create: {
    adGroup: resourceName(customerId, "adGroups", input.adGroupId),
    status: input.status,
    ad: {
      finalUrls: input.finalUrls,
      responsiveSearchAd: {
        headlines: input.headlines,
        descriptions: input.descriptions,
        ...(input.path1 ? { path1: input.path1 } : {}),
        ...(input.path2 ? { path2: input.path2 } : {}),
      },
    },
  } } }];
}

const STATUS_TARGETS = {
  CAMPAIGN: { operation: "campaignOperation", collection: "campaigns", id: numericIdSchema },
  AD_GROUP: { operation: "adGroupOperation", collection: "adGroups", id: numericIdSchema },
  AD: { operation: "adGroupAdOperation", collection: "adGroupAds", id: compositeIdSchema },
  KEYWORD: { operation: "adGroupCriterionOperation", collection: "adGroupCriteria", id: compositeIdSchema },
  ASSET_GROUP: { operation: "assetGroupOperation", collection: "assetGroups", id: numericIdSchema },
} as const;

export const setStatusSchema = z
  .object({
    ...writeBaseShape,
    entityType: z.enum(["CAMPAIGN", "AD_GROUP", "AD", "KEYWORD", "ASSET_GROUP"]),
    ids: z.array(z.string().trim().min(1)).min(1).max(100),
    status: statusSchema,
  })
  .superRefine((input, ctx) => {
    const idSchema = STATUS_TARGETS[input.entityType].id;
    input.ids.forEach((id, index) => {
      if (!idSchema.safeParse(id).success) {
        ctx.addIssue({
          code: "custom",
          path: ["ids", index],
          message: input.entityType === "AD" || input.entityType === "KEYWORD"
            ? "Use adGroupId~id for ads and keywords."
            : "Use a numeric ID.",
        });
      }
    });
  });

export function buildSetStatus(customerId: string, input: z.output<typeof setStatusSchema>): MutateOperation[] {
  const target = STATUS_TARGETS[input.entityType];
  return input.ids.map((id) => ({ [target.operation]: {
    update: { resourceName: resourceName(customerId, target.collection, id), status: input.status },
    updateMask: "status",
  } }));
}

export const updateBudgetSchema = z
  .object({
    ...writeBaseShape,
    budgetId: numericIdSchema,
    amountMicros: microsSchema.optional(),
    totalAmountMicros: microsSchema.optional(),
    name: z.string().trim().min(1).max(255).optional(),
  })
  .refine((input) => input.amountMicros || input.totalAmountMicros || input.name, {
    message: "Provide amountMicros, totalAmountMicros or name.",
  });

export function buildUpdateBudget(customerId: string, input: z.output<typeof updateBudgetSchema>): MutateOperation[] {
  const update: Record<string, unknown> = { resourceName: resourceName(customerId, "campaignBudgets", input.budgetId) };
  const mask: string[] = [];
  for (const field of ["amountMicros", "totalAmountMicros", "name"] as const) {
    if (input[field] !== undefined) {
      update[field] = input[field];
      mask.push(field);
    }
  }
  return [{ campaignBudgetOperation: { update, updateMask: mask.join(",") } }];
}
