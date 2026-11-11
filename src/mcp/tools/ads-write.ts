import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { toToolErrorText } from "@/lib/errors";
import { normalizeCustomerId } from "@/lib/customer-id";
import { getOperatorContext } from "@/lib/request-context";
import { customerIdSchema, jsonToolResult, optionalConnectionIdSchema } from "@/mcp/tools/schemas";
import { executeGuardedMutate } from "@/products/google-ads/api/mutate";
import { resolveAdsAccessContext } from "@/products/google-ads/routing";
import { requireAccessToken, searchGoogleAdsAll } from "@/products/google-ads/api/client";
import { MAX_UPLOAD_FILES } from "@/products/google-ads/api/upload-images";
import { issueUploadToken, UPLOAD_TOKEN_TTL_SECONDS, uploadUrl } from "@/products/google-ads/upload-token";
import type { MutateOperation } from "@/products/google-ads/api/write-policy";
import {
  assertClientAccount,
  assertWriteAllowed,
  MAX_MUTATE_OPERATIONS,
} from "@/products/google-ads/api/write-policy";
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

function toolError(error: unknown) {
  return { content: [{ type: "text" as const, text: toToolErrorText(error) }], isError: true };
}

function registerImageTools(server: McpServer): void {
  server.registerTool(
    "ads_create_image_upload_link",
    {
      title: "Create Google Ads image upload link",
      description:
        `Creates a link, valid for 30 minutes, to a page where the user uploads up to ${MAX_UPLOAD_FILES} image files from their computer (PNG, JPEG, GIF, WebP or AVIF, up to 10 MB each). Each file becomes an image asset in the customer account as soon as the user clicks Upload. Use this when images are on the user's computer, when a website blocks downloads, or instead of base64. Give the user the link, wait for them to finish, then call ads_list_image_assets to get the new asset IDs.`,
      inputSchema: z.object({ customerId: customerIdSchema, connectionId: optionalConnectionIdSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      try {
        const customerId = assertWriteAllowed(input.customerId);
        const access = await resolveAdsAccessContext(customerId, input.connectionId);
        assertClientAccount(access);
        const { operatorId, sessionId } = getOperatorContext();
        const token = issueUploadToken({
          operatorId,
          sessionId,
          customerId: access.customerId,
          connectionId: access.connectionId,
        });
        return jsonToolResult({
          url: uploadUrl(token),
          expiresInSeconds: UPLOAD_TOKEN_TTL_SECONDS,
          customerId: access.customerId,
          googleAccount: access.googleEmail,
          instructions: "Open the link, choose the images and click Upload. The page lists the new asset IDs.",
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "ads_list_image_assets",
    {
      title: "List Google Ads image assets",
      description:
        "Lists image assets in a customer account, newest first, with IDs, names, resource names and pixel dimensions. Use it to find images uploaded through ads_create_image_upload_link.",
      inputSchema: z.object({
        customerId: customerIdSchema,
        connectionId: optionalConnectionIdSchema,
        limit: z.number().int().min(1).max(200).default(25),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const access = await resolveAdsAccessContext(input.customerId, input.connectionId);
        const { results, requestId } = await searchGoogleAdsAll({
          customerId: access.customerId,
          accessToken: requireAccessToken((await access.client.getAccessToken()).token),
          loginCustomerId: access.loginCustomerId,
          maxPages: 1,
          query: `SELECT asset.id, asset.name, asset.resource_name, asset.image_asset.full_size.width_pixels, asset.image_asset.full_size.height_pixels FROM asset WHERE asset.type = 'IMAGE' ORDER BY asset.id DESC LIMIT ${input.limit}`,
        });
        const images = results.map((row) => {
          const asset = (row as { asset?: Record<string, unknown> }).asset ?? {};
          const size = (asset.imageAsset as { fullSize?: { widthPixels?: string; heightPixels?: string } } | undefined)
            ?.fullSize;
          return {
            assetId: asset.id ?? null,
            name: asset.name ?? null,
            resourceName: asset.resourceName ?? null,
            width: size?.widthPixels ? Number(size.widthPixels) : null,
            height: size?.heightPixels ? Number(size.heightPixels) : null,
          };
        });
        return jsonToolResult({ customerId: access.customerId, images, count: images.length, requestId });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

export function registerAdsWriteTools(server: McpServer): void {
  registerImageTools(server);

  registerWriteTool(
    server,
    "ads_mutate",
    {
      title: "Run guarded Google Ads mutate operations",
      description:
        "Runs up to 100 Google Ads API v25 GoogleAdsService.Mutate operations atomically, in REST JSON form, for example [{\"campaignOperation\":{\"update\":{\"resourceName\":\"customers/123/campaigns/456\",\"name\":\"New\"},\"updateMask\":\"name\"}}]. Supports create and update for any resource, including Search, Display, Performance Max, Demand Gen and App campaigns, bidding strategies, conversion actions, assets, extensions and labels. Use negative temporary IDs such as customers/123/campaignBudgets/-1 to reference resources created in the same request. remove is only allowed for links and targeting criteria (campaign or ad group criteria other than positive keywords, negatives, asset links, shared set links, labels, bid modifiers). New campaigns are always PAUSED. Budgets are capped by server settings. Classic Video campaigns cannot be created or edited through the API; use Demand Gen for YouTube. Never hand-type base64 image data in imageAsset.data; create image assets with ads_create_asset (image URL) or ads_create_image_upload_link (files from the user's computer), then reference the asset IDs. " +
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
        "Creates a text asset, a YouTube video asset from an existing YouTube video ID, or an image asset downloaded from a direct image URL. Image downloads follow up to 3 redirects, accept PNG, JPEG, GIF, WebP and AVIF up to 20 MB, and convert WebP/AVIF automatically; the URL must open the image itself, not a web page. If the website blocks the download or the image is on the user's computer, use ads_create_image_upload_link instead. Never hand-type base64 image data. Returns the new asset resource name for use in ads.",
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
