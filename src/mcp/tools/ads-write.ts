import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { toToolErrorText } from "@/lib/errors";
import { normalizeCustomerId } from "@/lib/customer-id";
import { jsonToolResult } from "@/mcp/tools/schemas";
import { executeGuardedMutate } from "@/products/google-ads/api/mutate";
import type { MutateOperation } from "@/products/google-ads/api/write-policy";
import { MAX_MUTATE_OPERATIONS } from "@/products/google-ads/api/write-policy";
import { writeBaseShape } from "@/products/google-ads/api/builders/common";
import { buildAsset, createAssetSchema } from "@/products/google-ads/api/builders/assets";
import { buildDemandGenCampaign, demandGenCampaignSchema } from "@/products/google-ads/api/builders/demand-gen";
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
} from "@/products/google-ads/api/builders/entities";
import { buildTargeting, setTargetingSchema } from "@/products/google-ads/api/builders/targeting";

const WRITE_FLOW =
  "Defaults to validateOnly=true, which saves nothing. Show the validated plan to the user and obtain explicit approval before calling again with validateOnly=false and confirm=true. Never automatically retry after a timeout; read the resources first.";

const NO_DELETE =
  "Deleting budgets, campaigns, ad groups, ads, keywords or assets is not allowed; pause them instead.";

export const adsMutateSchema = z.object({
  ...writeBaseShape,
  operations: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_MUTATE_OPERATIONS),
});

interface WriteInput {
  customerId: string;
  connectionId?: string;
  validateOnly: boolean;
  confirm: boolean;
}

type Builder<T> = (customerId: string, input: T) => MutateOperation[] | Promise<MutateOperation[]>;

function registerWriteTool<S extends z.ZodType<WriteInput>>(
  server: McpServer,
  name: string,
  config: { title: string; description: string; inputSchema: S; destructive?: boolean },
  build: Builder<z.output<S>>,
): void {
  const handler = async (input: z.output<S>) => {
    try {
      const customerId = normalizeCustomerId(input.customerId);
      return jsonToolResult(await executeGuardedMutate({
        customerId,
        connectionId: input.connectionId,
        operations: await build(customerId, input),
        validateOnly: input.validateOnly,
        confirm: input.confirm,
      }));
    } catch (error) {
      return { content: [{ type: "text" as const, text: toToolErrorText(error) }], isError: true };
    }
  };
  server.registerTool(
    name,
    {
      title: config.title,
      description: `${config.description} ${WRITE_FLOW}`,
      inputSchema: config.inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: config.destructive ?? false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    // The SDK overloads cannot infer the callback type from a generic schema parameter.
    handler as never,
  );
}

export function registerAdsWriteTools(server: McpServer): void {
  registerWriteTool(
    server,
    "ads_mutate",
    {
      title: "Run guarded Google Ads mutate operations",
      description:
        "Runs up to 100 Google Ads API v25 GoogleAdsService.Mutate operations atomically, in REST JSON form, for example [{\"campaignOperation\":{\"update\":{\"resourceName\":\"customers/123/campaigns/456\",\"name\":\"New\"},\"updateMask\":\"name\"}}]. Supports create and update for any resource, including Search, Display, Performance Max, Demand Gen and App campaigns, bidding strategies, conversion actions, assets, extensions and labels. Use negative temporary IDs such as customers/123/campaignBudgets/-1 to reference resources created in the same request. remove is only allowed for links and targeting criteria (campaign or ad group criteria other than positive keywords, negatives, asset links, shared set links, labels, bid modifiers). New campaigns are always PAUSED. Budgets are capped by server settings. Classic Video campaigns cannot be created or edited through the API; use Demand Gen for YouTube. " +
        NO_DELETE,
      inputSchema: adsMutateSchema,
      destructive: true,
    },
    (_customerId, input) => input.operations as MutateOperation[],
  );

  registerWriteTool(
    server,
    "ads_create_demand_gen_campaign",
    {
      title: "Create paused YouTube (Demand Gen) campaign",
      description:
        "Creates a dedicated budget, a PAUSED Demand Gen campaign, an ad group with channel controls (defaults to YouTube in-stream, in-feed and Shorts), optional location and language targeting, and an optional video responsive ad, atomically. Videos must already be on YouTube; pass their 11-character IDs. The logo must be an existing image asset (create one with ads_create_asset). Ask the user for the EU political advertising declaration.",
      inputSchema: demandGenCampaignSchema,
    },
    buildDemandGenCampaign,
  );

  registerWriteTool(
    server,
    "ads_create_asset",
    {
      title: "Create Google Ads asset",
      description:
        "Creates a text asset, a YouTube video asset from an existing YouTube video ID, or an image asset downloaded from a public https URL (PNG, JPEG or GIF, at most 5 MB, no redirects). Returns the new asset resource name for use in ads.",
      inputSchema: createAssetSchema,
    },
    buildAsset,
  );

  registerWriteTool(
    server,
    "ads_create_ad_group",
    {
      title: "Create Google Ads ad group",
      description: "Creates a Search or Display ad group in an existing campaign. Defaults to PAUSED.",
      inputSchema: createAdGroupSchema,
    },
    buildAdGroup,
  );

  registerWriteTool(
    server,
    "ads_add_keywords",
    {
      title: "Add Google Ads keywords",
      description:
        "Adds up to 100 positive keywords to an ad group, or negative keywords to an ad group or campaign, with EXACT, PHRASE or BROAD match. Keyword text cannot be edited later; pause a keyword and add a new one instead.",
      inputSchema: addKeywordsSchema,
    },
    buildKeywords,
  );

  registerWriteTool(
    server,
    "ads_create_responsive_search_ad",
    {
      title: "Create responsive search ad",
      description:
        "Creates a responsive search ad with 3 to 15 headlines (30 characters each), 2 to 4 descriptions (90 characters each), final URLs and optional display paths. Defaults to PAUSED.",
      inputSchema: createResponsiveSearchAdSchema,
    },
    buildResponsiveSearchAd,
  );

  registerWriteTool(
    server,
    "ads_set_status",
    {
      title: "Enable or pause Google Ads entities",
      description:
        "Sets campaigns, ad groups, ads, keywords or asset groups to ENABLED or PAUSED. Ads and keywords use adGroupId~id. Enabling a campaign can start spending money. " +
        NO_DELETE,
      inputSchema: setStatusSchema,
    },
    buildSetStatus,
  );

  registerWriteTool(
    server,
    "ads_update_budget",
    {
      title: "Update Google Ads budget",
      description:
        "Changes a campaign budget's daily amountMicros, custom-period totalAmountMicros, or name. Amounts are capped by server settings. Find budget IDs with ads_run_query on campaign.campaign_budget.",
      inputSchema: updateBudgetSchema,
    },
    buildUpdateBudget,
  );

  registerWriteTool(
    server,
    "ads_set_targeting",
    {
      title: "Add or remove Google Ads targeting",
      description:
        "Adds or removes campaign or ad group targeting criteria: locations, languages, devices and ad schedules (campaign only), audiences, age ranges and genders, with optional negatives and bid modifiers. Look up location IDs with ads_run_query on geo_target_constant. Removal only detaches criteria; positive keywords cannot be removed.",
      inputSchema: setTargetingSchema,
      destructive: true,
    },
    buildTargeting,
  );
}
