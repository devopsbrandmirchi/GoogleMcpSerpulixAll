import { z } from "zod";
import { AppError } from "@/lib/errors";
import { normalizeCustomerId } from "@/lib/customer-id";
import { customerIdSchema, optionalConnectionIdSchema } from "@/mcp/tools/schemas";
import { resolveAdsAccessContext } from "@/products/google-ads/routing";
import { adsRequest, requireAccessToken } from "@/products/google-ads/api/client";

export const createCampaignSchema = z.object({
  customerId: customerIdSchema,
  connectionId: optionalConnectionIdSchema,
  name: z.string().trim().min(1).max(128),
  dailyBudgetMicros: z.string().regex(/^[1-9][0-9]{0,15}$/),
  containsEuPoliticalAdvertising: z.enum([
    "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    "CONTAINS_EU_POLITICAL_ADVERTISING",
  ]),
  validateOnly: z.boolean().default(true),
  confirm: z.boolean().default(false),
});

// A single atomic mutation avoids leaving an orphaned budget if campaign creation fails.
export async function createSearchCampaign(raw: z.input<typeof createCampaignSchema>) {
  const input = createCampaignSchema.parse(raw);
  const customerId = normalizeCustomerId(input.customerId);
  if (process.env.GOOGLE_ADS_WRITES_ENABLED !== "true") {
    throw new AppError("Google Ads creation is disabled. Set GOOGLE_ADS_WRITES_ENABLED=true.", "configuration_error", 403);
  }
  const entries = (process.env.GOOGLE_ADS_WRITE_CUSTOMER_IDS ?? "")
    .split(",").map((id) => id.trim()).filter(Boolean);
  const allowAny = entries.includes("*");
  const allowed = entries.filter((id) => id !== "*").map(normalizeCustomerId);
  if (!allowAny && !allowed.includes(customerId)) {
    throw new AppError("Customer is not in GOOGLE_ADS_WRITE_CUSTOMER_IDS.", "resource_not_accessible", 403);
  }
  const maximum = process.env.GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS ?? "";
  if (!/^[1-9][0-9]{0,15}$/.test(maximum)) {
    throw new AppError("Set GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS to a positive integer.", "configuration_error", 400);
  }
  if (BigInt(input.dailyBudgetMicros) > BigInt(maximum)) {
    throw new AppError("Daily budget exceeds GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS.", "validation", 400);
  }
  if (!input.validateOnly && !input.confirm) {
    throw new AppError("Review the validated plan and obtain user approval before setting confirm=true and validateOnly=false.", "validation", 400);
  }
  const access = await resolveAdsAccessContext(customerId, input.connectionId);
  if (access.isManager) {
    throw new AppError("Select a client account, not an MCC manager account.", "validation", 400);
  }
  const budget = `customers/${access.customerId}/campaignBudgets/-1`;
  const mutateOperations = [
    { campaignBudgetOperation: { create: {
      resourceName: budget,
      name: `${input.name} budget`,
      amountMicros: input.dailyBudgetMicros,
      deliveryMethod: "STANDARD",
      explicitlyShared: false,
    } } },
    { campaignOperation: { create: {
      name: input.name,
      status: "PAUSED",
      advertisingChannelType: "SEARCH",
      campaignBudget: budget,
      manualCpc: {},
      containsEuPoliticalAdvertising: input.containsEuPoliticalAdvertising,
      networkSettings: {
        targetGoogleSearch: true,
        targetSearchNetwork: false,
        targetContentNetwork: false,
        targetPartnerSearchNetwork: false,
      },
    } } },
  ];
  const response = await adsRequest({
    path: `/customers/${access.customerId}/googleAds:mutate`,
    method: "POST",
    accessToken: requireAccessToken((await access.client.getAccessToken()).token),
    loginCustomerId: access.loginCustomerId,
    body: { mutateOperations, validateOnly: input.validateOnly, partialFailure: false },
  });
  return {
    customerId: access.customerId,
    validated: input.validateOnly,
    created: !input.validateOnly,
    plan: { name: input.name, dailyBudgetMicros: input.dailyBudgetMicros,
      status: "PAUSED", channel: "SEARCH", bidding: "MANUAL_CPC",
      containsEuPoliticalAdvertising: input.containsEuPoliticalAdvertising },
    result: response.body,
    requestId: response.requestId,
    note: "No ad groups, keywords, ads, or targeting are created. Do not retry an ambiguous timeout automatically; check ads_campaigns first to avoid duplicates.",
  };
}
