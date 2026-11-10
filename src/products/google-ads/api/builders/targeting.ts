import { z } from "zod";
import type { MutateOperation } from "@/products/google-ads/api/write-policy";
import { numericIdSchema, resourceName, writeBaseShape } from "@/products/google-ads/api/builders/common";

const bidModifierSchema = z.number().min(0).max(10);

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
const MINUTES = { 0: "ZERO", 15: "FIFTEEN", 30: "THIRTY", 45: "FORTY_FIVE" } as const;
const minuteSchema = z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(45)]).default(0);

const criterionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("LOCATION"),
    geoTargetConstantId: numericIdSchema,
    negative: z.boolean().default(false),
    bidModifier: bidModifierSchema.optional(),
  }),
  z.object({ type: z.literal("LANGUAGE"), languageConstantId: numericIdSchema }),
  z.object({
    type: z.literal("DEVICE"),
    device: z.enum(["MOBILE", "DESKTOP", "TABLET", "CONNECTED_TV"]),
    bidModifier: bidModifierSchema,
  }),
  z.object({
    type: z.literal("AD_SCHEDULE"),
    dayOfWeek: z.enum(DAYS),
    startHour: z.number().int().min(0).max(23),
    startMinute: minuteSchema,
    endHour: z.number().int().min(0).max(24),
    endMinute: minuteSchema,
    bidModifier: bidModifierSchema.optional(),
  }),
  z.object({
    type: z.literal("AUDIENCE"),
    userListId: numericIdSchema.optional(),
    userInterestId: numericIdSchema.optional(),
    negative: z.boolean().default(false),
    bidModifier: bidModifierSchema.optional(),
  }).refine((item) => Boolean(item.userListId) !== Boolean(item.userInterestId), {
    message: "Provide exactly one of userListId or userInterestId.",
  }),
  z.object({
    type: z.literal("AGE_RANGE"),
    ageRange: z.enum([
      "AGE_RANGE_18_24", "AGE_RANGE_25_34", "AGE_RANGE_35_44",
      "AGE_RANGE_45_54", "AGE_RANGE_55_64", "AGE_RANGE_65_UP", "AGE_RANGE_UNDETERMINED",
    ]),
    negative: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("GENDER"),
    gender: z.enum(["MALE", "FEMALE", "UNDETERMINED"]),
    negative: z.boolean().default(false),
  }),
]);

type Criterion = z.output<typeof criterionSchema>;

const CAMPAIGN_ONLY = new Set<Criterion["type"]>(["DEVICE", "AD_SCHEDULE"]);

export const setTargetingSchema = z
  .object({
    ...writeBaseShape,
    campaignId: numericIdSchema.optional(),
    adGroupId: numericIdSchema.optional(),
    add: z.array(criterionSchema).max(100).default([]),
    removeCriterionIds: z.array(numericIdSchema).max(100).default([]),
  })
  .refine((input) => Boolean(input.campaignId) !== Boolean(input.adGroupId), {
    message: "Provide exactly one of campaignId or adGroupId.",
  })
  .refine((input) => input.add.length + input.removeCriterionIds.length > 0, {
    message: "Provide criteria to add or criterion IDs to remove.",
  })
  .refine((input) => !input.adGroupId || input.add.every((item) => !CAMPAIGN_ONLY.has(item.type)), {
    message: "DEVICE and AD_SCHEDULE criteria can only be set on a campaign.",
  });

export type SetTargetingInput = z.output<typeof setTargetingSchema>;

function criterionFields(customerId: string, item: Criterion): Record<string, unknown> {
  const negative = "negative" in item && item.negative ? { negative: true } : {};
  const bid = "bidModifier" in item && item.bidModifier !== undefined ? { bidModifier: item.bidModifier } : {};
  switch (item.type) {
    case "LOCATION":
      return { ...negative, ...bid, location: { geoTargetConstant: `geoTargetConstants/${item.geoTargetConstantId}` } };
    case "LANGUAGE":
      return { language: { languageConstant: `languageConstants/${item.languageConstantId}` } };
    case "DEVICE":
      return { ...bid, device: { type: item.device } };
    case "AD_SCHEDULE":
      return { ...bid, adSchedule: {
        dayOfWeek: item.dayOfWeek,
        startHour: item.startHour,
        startMinute: MINUTES[item.startMinute],
        endHour: item.endHour,
        endMinute: MINUTES[item.endMinute],
      } };
    case "AUDIENCE":
      return item.userListId
        ? { ...negative, ...bid, userList: { userList: resourceName(customerId, "userLists", item.userListId) } }
        : { ...negative, ...bid, userInterest: {
          userInterestCategory: resourceName(customerId, "userInterests", item.userInterestId!),
        } };
    case "AGE_RANGE":
      return { ...negative, ageRange: { type: item.ageRange } };
    case "GENDER":
      return { ...negative, gender: { type: item.gender } };
  }
}

export function buildTargeting(customerId: string, input: SetTargetingInput): MutateOperation[] {
  const atCampaign = Boolean(input.campaignId);
  const operation = atCampaign ? "campaignCriterionOperation" : "adGroupCriterionOperation";
  const parent = atCampaign
    ? { campaign: resourceName(customerId, "campaigns", input.campaignId!) }
    : { adGroup: resourceName(customerId, "adGroups", input.adGroupId!) };
  const collection = atCampaign ? "campaignCriteria" : "adGroupCriteria";
  const parentId = atCampaign ? input.campaignId! : input.adGroupId!;

  return [
    ...input.add.map((item) => ({ [operation]: { create: { ...parent, ...criterionFields(customerId, item) } } })),
    ...input.removeCriterionIds.map((id) => ({ [operation]: {
      remove: resourceName(customerId, collection, `${parentId}~${id}`),
    } })),
  ];
}
