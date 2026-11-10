import { z } from "zod";
import { normalizeCustomerId } from "@/lib/customer-id";
import { customerIdSchema, optionalConnectionIdSchema } from "@/mcp/tools/schemas";
import { executeGuardedMutate } from "@/products/google-ads/api/mutate";

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
  const budget = `customers/${customerId}/campaignBudgets/-1`;
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
  const outcome = await executeGuardedMutate({
    customerId,
    connectionId: input.connectionId,
    operations: mutateOperations,
    validateOnly: input.validateOnly,
    confirm: input.confirm,
  });
  return {
    customerId: outcome.customerId,
    validated: outcome.validated,
    created: outcome.executed,
    plan: { name: input.name, dailyBudgetMicros: input.dailyBudgetMicros,
      status: "PAUSED", channel: "SEARCH", bidding: "MANUAL_CPC",
      containsEuPoliticalAdvertising: input.containsEuPoliticalAdvertising },
    result: outcome.result,
    requestId: outcome.requestId,
    note: "No ad groups, keywords, ads, or targeting are created. Do not retry an ambiguous timeout automatically; check ads_campaigns first to avoid duplicates.",
  };
}
