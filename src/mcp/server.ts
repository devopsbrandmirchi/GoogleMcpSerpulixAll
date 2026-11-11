import { createMcpHandler } from "mcp-handler";
import { APP_VERSION, isDv360Enabled } from "@/lib/config";
import { logger } from "@/lib/logger";
import { createRequestId, runWithOperator } from "@/lib/request-context";
import { extractMcpToken, tryReadAccessToken } from "@/mcp/auth";
import {
  mcpOptionsResponse,
  mcpProbeGetResponse,
  toJsonRpcResponse,
  withCors,
  withStreamableAccept,
} from "@/mcp/http";
import { wwwAuthenticateHeader } from "@/mcp/oauth/metadata";
import { registerAdsTools } from "@/mcp/tools/ads";
import { registerAdsWriteTools } from "@/mcp/tools/ads-write";
import { registerDv360Tools } from "@/mcp/tools/dv360";
import { registerDisconnectConnectionTool } from "@/mcp/tools/disconnect-connection";
import { registerGetActivePropertyTool } from "@/mcp/tools/get-active-property";
import { registerGetOperatorTool } from "@/mcp/tools/get-operator";
import { registerListAccountsTool } from "@/mcp/tools/list-accounts";
import { registerListConnectionsTool } from "@/mcp/tools/list-connections";
import { registerListPropertiesTool } from "@/mcp/tools/list-properties";
import { registerMetadataTool } from "@/mcp/tools/metadata";
import { registerRealtimeTool } from "@/mcp/tools/realtime";
import { registerRunReportTool } from "@/mcp/tools/run-report";
import { registerSetActivePropertyTool } from "@/mcp/tools/set-active-property";
import { registerStartConnectionTool } from "@/mcp/tools/start-connection";
import { getAppStore } from "@/store/app-store";
import { normalizeSessionId } from "@/store/types";

export function unauthorizedMcpResponse(): Response {
  return withCors(
    new Response(
      JSON.stringify({
        error: "invalid_token",
        error_description: "Authentication required",
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "WWW-Authenticate": wwwAuthenticateHeader(),
        },
      },
    ),
  );
}

function serverInstructions(dv360: boolean): string {
  return [
    `This is a True Model B Google Marketing connector. Identify the operator with google_get_operator, list Google connections with google_connections_list, then use ga4_* tools for Analytics${dv360 ? ", ads_* tools for Google Ads, and dv360_* tools for Display & Video 360" : " and ads_* tools for Google Ads"}.`,
    "The server routes each resource to the Google connection that owns it. Never invent resource IDs.",
    dv360 ? "DV360 is read-only." : "",
    "Google Ads reads use ads_run_query and the listing tools. When server write settings allow it, Google Ads can be edited with ads_mutate (any create or update operation) and typed tools: ads_create_campaign (Search), ads_create_demand_gen_campaign (YouTube), ads_create_asset, ads_create_ad_group, ads_add_keywords, ads_create_responsive_search_ad, ads_set_status, ads_update_budget and ads_set_targeting.",
    "Nothing can be deleted: pause budgets, campaigns, ad groups, ads, keywords and assets instead; only targeting criteria and links can be removed. New campaigns are always PAUSED. YouTube campaigns are built as Demand Gen because classic Video campaigns cannot be created or edited through the API.",
    "For images, use ads_create_asset with a direct image URL, or ads_create_image_upload_link so the user can upload files from their computer, then ads_list_image_assets to get the asset IDs; never type base64 image data. Display ads need a landscape 1.91:1 image (at least 600x314), a square 1:1 image (at least 300x300), and optionally a 1:1 or 4:1 logo.",
    "For every write, validate first, show the plan, and obtain explicit user approval before calling again with validateOnly=false and confirm=true. Never automatically retry a write after an ambiguous timeout.",
    dv360 ? "If a connection is missing the DV360 scope, reconnect it with google_connections_start." : "",
  ].filter(Boolean).join(" ");
}

function createInnerHandler() {
  const dv360 = isDv360Enabled();
  return createMcpHandler(
    (server) => {
      registerGetOperatorTool(server);
      registerListConnectionsTool(server);
      registerStartConnectionTool(server);
      registerDisconnectConnectionTool(server);
      registerListAccountsTool(server);
      registerListPropertiesTool(server);
      registerGetActivePropertyTool(server);
      registerSetActivePropertyTool(server);
      registerMetadataTool(server);
      registerRunReportTool(server);
      registerRealtimeTool(server);
      registerAdsTools(server);
      registerAdsWriteTools(server);
      if (dv360) {
        registerDv360Tools(server);
      }
    },
    {
      serverInfo: {
        name: "google-mcp-serpulix-all",
        version: APP_VERSION,
      },
      instructions: serverInstructions(dv360),
      onEvent: (event) => {
        if (event.type === "ERROR") {
          logger.error("MCP handler error", {
            source: event.source,
            severity: event.severity,
            context: event.context,
          });
        }
      },
    },
  );
}

function toolNameFromBody(body: unknown): string | undefined {
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    if (message && typeof message === "object") {
      const params = (message as { params?: { name?: unknown } }).params;
      if (typeof params?.name === "string") {
        return params.name;
      }
    }
  }
  return undefined;
}

export function createGconnectMcpHandler() {
  const handler = createInnerHandler();

  return async (req: Request): Promise<Response> => {
    const requestId = createRequestId(req);
    const started = Date.now();

    if (req.method === "OPTIONS") {
      return mcpOptionsResponse();
    }

    let body: unknown;
    if (req.method === "POST") {
      try {
        body = await req.clone().json();
      } catch {
        body = undefined;
      }
    }
    const mcpOperation = toolNameFromBody(body) ?? req.method.toLowerCase();

    const token = extractMcpToken(req);
    const payload = tryReadAccessToken(token);
    if (!payload?.sub) {
      logger.warn("Unauthorized MCP request", { requestId, mcpOperation, success: false });
      return unauthorizedMcpResponse();
    }

    const operator = await getAppStore().getOperator(payload.sub);
    if (!operator) {
      logger.warn("Unknown operator for MCP token", { requestId, mcpOperation, success: false });
      return unauthorizedMcpResponse();
    }

    void getAppStore().touchLastAccess(operator.operatorId);

    if (req.method === "GET") {
      return mcpProbeGetResponse();
    }
    if (req.method === "DELETE") {
      return new Response(null, { status: 204 });
    }

    return runWithOperator(
      {
        requestId,
        operatorId: operator.operatorId,
        sessionId: normalizeSessionId(payload.sid),
      },
      async () => {
        try {
          const response = await toJsonRpcResponse(await handler(withStreamableAccept(req)));
          logger.info("MCP request", {
            requestId,
            operatorId: operator.operatorId,
            mcpOperation,
            success: response.ok,
            durationMs: Date.now() - started,
          });
          return response;
        } catch (error) {
          logger.error("MCP request failed", {
            requestId,
            operatorId: operator.operatorId,
            mcpOperation,
            success: false,
            errorCategory: error instanceof Error ? error.name : "unknown",
            durationMs: Date.now() - started,
          });
          throw error;
        }
      },
    );
  };
}
