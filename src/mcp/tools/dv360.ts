import type { McpServer } from "@modelcontextprotocol/server";
import { toToolErrorText } from "@/lib/errors";
import { loadCurrentOperator } from "@/products/ga4/routing";
import {
  DV360_EMPTY_ACCESS_HINT,
  listAccessibleDv360Advertisers,
  listAccessibleDv360Partners,
  resolveDv360AdvertiserAccess,
} from "@/products/dv360/routing";
import {
  getDv360Resource,
  listDv360Collection,
  listFilter,
  requireAccessToken,
} from "@/products/dv360/api/client";
import {
  dv360GetAdvertiserInputSchema,
  dv360ListAdvertisersInputSchema,
  dv360ListPartnersInputSchema,
  dv360PagedAdvertiserInputSchema,
  jsonToolResult,
} from "@/mcp/tools/schemas";

async function listAdvertiserCollection(
  pathSuffix: string,
  itemsKey: string,
  input: {
    advertiserId: string;
    connectionId?: string;
    pageSize?: number;
    pageToken?: string;
    filter?: string;
    entityStatus?: string;
    orderBy?: string;
  },
) {
  const access = await resolveDv360AdvertiserAccess(input.advertiserId, input.connectionId);
  const accessToken = requireAccessToken((await access.client.getAccessToken()).token);
  const page = await listDv360Collection({
    path: `/advertisers/${access.advertiserId}/${pathSuffix}`,
    accessToken,
    itemsKey,
    pageSize: input.pageSize,
    pageToken: input.pageToken,
    filter: listFilter(input),
    orderBy: input.orderBy,
  });
  return {
    advertiserId: access.advertiserId,
    partnerId: access.partnerId,
    googleAccount: access.googleEmail,
    connectionId: access.connectionId,
    items: page.items,
    count: page.items.length,
    nextPageToken: page.nextPageToken ?? null,
    requestId: page.requestId,
  };
}

export function registerDv360Tools(server: McpServer): void {
  server.registerTool(
    "dv360_list_partners",
    {
      title: "List DV360 partners",
      description:
        "Lists discovered Display & Video 360 partners for the authenticated operator, grouped by Google connection. Does not expose tokens.",
      inputSchema: dv360ListPartnersInputSchema,
    },
    async (input) => {
      try {
        const operator = await loadCurrentOperator();
        const partners = await listAccessibleDv360Partners(operator.operatorId, input.connectionId);
        return jsonToolResult({
          partners,
          count: partners.length,
          ...(partners.length === 0 ? { hint: DV360_EMPTY_ACCESS_HINT } : {}),
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
    "dv360_list_advertisers",
    {
      title: "List DV360 advertisers",
      description:
        "Lists discovered Display & Video 360 advertisers for the authenticated operator. Optionally filter by partnerId or connectionId.",
      inputSchema: dv360ListAdvertisersInputSchema,
    },
    async (input) => {
      try {
        const operator = await loadCurrentOperator();
        const advertisers = await listAccessibleDv360Advertisers(operator.operatorId, {
          connectionId: input.connectionId,
          partnerId: input.partnerId,
        });
        return jsonToolResult({
          advertisers,
          count: advertisers.length,
          ...(advertisers.length === 0 ? { hint: DV360_EMPTY_ACCESS_HINT } : {}),
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
    "dv360_get_advertiser",
    {
      title: "Get DV360 advertiser",
      description:
        "Returns live Display & Video 360 advertiser details for an advertiser the current operator can access. The server resolves the owning Google connection.",
      inputSchema: dv360GetAdvertiserInputSchema,
    },
    async (input) => {
      try {
        const access = await resolveDv360AdvertiserAccess(input.advertiserId, input.connectionId);
        const accessToken = requireAccessToken((await access.client.getAccessToken()).token);
        const { resource, requestId } = await getDv360Resource({
          path: `/advertisers/${access.advertiserId}`,
          accessToken,
        });
        return jsonToolResult({
          advertiserId: access.advertiserId,
          partnerId: access.partnerId,
          googleAccount: access.googleEmail,
          connectionId: access.connectionId,
          advertiser: resource,
          requestId,
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
    "dv360_list_campaigns",
    {
      title: "List DV360 campaigns",
      description:
        "Lists campaigns for an authorized DV360 advertiser. Supports pageSize, pageToken, and official filter/entityStatus values.",
      inputSchema: dv360PagedAdvertiserInputSchema,
    },
    async (input) => {
      try {
        return jsonToolResult(await listAdvertiserCollection("campaigns", "campaigns", input));
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "dv360_list_insertion_orders",
    {
      title: "List DV360 insertion orders",
      description:
        "Lists insertion orders for an authorized DV360 advertiser. Supports pageSize, pageToken, and official filter/entityStatus values.",
      inputSchema: dv360PagedAdvertiserInputSchema,
    },
    async (input) => {
      try {
        return jsonToolResult(await listAdvertiserCollection("insertionOrders", "insertionOrders", input));
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "dv360_list_line_items",
    {
      title: "List DV360 line items",
      description:
        "Lists line items for an authorized DV360 advertiser. Supports pageSize, pageToken, and official filter/entityStatus values.",
      inputSchema: dv360PagedAdvertiserInputSchema,
    },
    async (input) => {
      try {
        return jsonToolResult(await listAdvertiserCollection("lineItems", "lineItems", input));
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "dv360_list_creatives",
    {
      title: "List DV360 creatives",
      description:
        "Lists creatives for an authorized DV360 advertiser. Supports pageSize, pageToken, and official filter values only.",
      inputSchema: dv360PagedAdvertiserInputSchema,
    },
    async (input) => {
      try {
        return jsonToolResult(await listAdvertiserCollection("creatives", "creatives", input));
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );
}
