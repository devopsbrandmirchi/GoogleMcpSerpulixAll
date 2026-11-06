import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { toToolErrorText } from "@/lib/errors";
import { loadCurrentOperator } from "@/products/ga4/routing";
import {
  listAccessibleAdsAccounts,
  resolveAdsAccessContext,
} from "@/products/google-ads/routing";
import { assertReadOnlyGaql } from "@/products/google-ads/api/gaql";
import { requireAccessToken, searchGoogleAdsAll } from "@/products/google-ads/api/client";
import {
  adsCustomerInputSchema,
  adsQueryInputSchema,
  adsReportingInputSchema,
  jsonToolResult,
  optionalConnectionIdSchema,
} from "@/mcp/tools/schemas";
import { getAppStore } from "@/store/app-store";

function flattenAdsRows(results: unknown[]): Array<Record<string, unknown>> {
  return results.map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>) : { value: row }));
}

async function runResolvedQuery(params: {
  customerId: string;
  query: string;
  connectionId?: string;
}) {
  const access = await resolveAdsAccessContext(params.customerId, params.connectionId);
  const accessToken = requireAccessToken((await access.client.getAccessToken()).token);
  const query = assertReadOnlyGaql(params.query);
  const { results, requestId } = await searchGoogleAdsAll({
    customerId: access.customerId,
    query,
    accessToken,
    loginCustomerId: access.loginCustomerId,
  });
  return {
    customerId: access.customerId,
    googleAccount: access.googleEmail,
    rows: flattenAdsRows(results),
    rowCount: results.length,
    requestId,
  };
}

export function registerAdsTools(server: McpServer): void {
  server.registerTool(
    "ads_list_accessible_accounts",
    {
      title: "List Google Ads accounts",
      description:
        "Lists discovered Google Ads manager and client accounts for the authenticated operator, grouped by Google connection. Does not expose tokens.",
      inputSchema: z.object({
        connectionId: optionalConnectionIdSchema,
      }),
    },
    async (input) => {
      try {
        const operator = await loadCurrentOperator();
        const accounts = await listAccessibleAdsAccounts(operator.operatorId, input.connectionId);
        return jsonToolResult({ accounts, count: accounts.length });
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "ads_get_account_hierarchy",
    {
      title: "Get Google Ads account hierarchy",
      description:
        "Returns the manager/client hierarchy discovered for a Google connection owned by the current operator.",
      inputSchema: z.object({
        connectionId: optionalConnectionIdSchema,
      }),
    },
    async (input) => {
      try {
        const operator = await loadCurrentOperator();
        const [accounts, edges] = await Promise.all([
          listAccessibleAdsAccounts(operator.operatorId, input.connectionId),
          getAppStore().listAdsHierarchyEdges(operator.operatorId, input.connectionId),
        ]);
        return jsonToolResult({
          accounts,
          edges: edges.map((edge) => ({
            connectionId: edge.connectionId,
            managerCustomerId: edge.managerCustomerId,
            clientCustomerId: edge.clientCustomerId,
            level: edge.level,
          })),
        });
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "ads_get_account",
    {
      title: "Get Google Ads account",
      description:
        "Returns metadata for one Google Ads customer the current operator can access. The server resolves the Google connection and login-customer-id.",
      inputSchema: adsCustomerInputSchema,
    },
    async (input) => {
      try {
        const access = await resolveAdsAccessContext(input.customerId, input.connectionId);
        return jsonToolResult({
          customerId: access.customerId,
          name: access.descriptiveName,
          manager: access.isManager,
          directlyAccessible: access.directlyAccessible,
          googleAccount: access.googleEmail,
        });
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "ads_run_query",
    {
      title: "Run Google Ads GAQL query",
      description:
        "Runs a read-only Google Ads Query Language SELECT query. The server resolves the Google connection and login-customer-id. Mutations are rejected.",
      inputSchema: adsQueryInputSchema,
    },
    async (input) => {
      try {
        return jsonToolResult(await runResolvedQuery(input));
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "ads_campaigns",
    {
      title: "List Google Ads campaigns",
      description: "Lists campaigns for an authorized Google Ads customer.",
      inputSchema: adsReportingInputSchema,
    },
    async (input) => {
      try {
        return jsonToolResult(
          await runResolvedQuery({
            customerId: input.customerId,
            connectionId: input.connectionId,
            query: `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign ORDER BY campaign.id LIMIT ${input.limit}`,
          }),
        );
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "ads_ad_groups",
    {
      title: "List Google Ads ad groups",
      description: "Lists ad groups for an authorized Google Ads customer.",
      inputSchema: adsReportingInputSchema,
    },
    async (input) => {
      try {
        return jsonToolResult(
          await runResolvedQuery({
            customerId: input.customerId,
            connectionId: input.connectionId,
            query: `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.campaign FROM ad_group ORDER BY ad_group.id LIMIT ${input.limit}`,
          }),
        );
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "ads_ads",
    {
      title: "List Google Ads ads",
      description: "Lists ads for an authorized Google Ads customer.",
      inputSchema: adsReportingInputSchema,
    },
    async (input) => {
      try {
        return jsonToolResult(
          await runResolvedQuery({
            customerId: input.customerId,
            connectionId: input.connectionId,
            query: `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group_ad.ad_group FROM ad_group_ad ORDER BY ad_group_ad.ad.id LIMIT ${input.limit}`,
          }),
        );
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "ads_campaign_performance",
    {
      title: "Google Ads campaign performance",
      description:
        "Returns campaign performance metrics for an authorized customer. Optional startDate and endDate use YYYY-MM-DD.",
      inputSchema: adsReportingInputSchema,
    },
    async (input) => {
      try {
        const start = input.startDate ?? "30 days ago";
        const end = input.endDate ?? "today";
        return jsonToolResult(
          await runResolvedQuery({
            customerId: input.customerId,
            connectionId: input.connectionId,
            query: `SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${start}' AND '${end}' ORDER BY metrics.impressions DESC LIMIT ${input.limit}`,
          }),
        );
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );
}
