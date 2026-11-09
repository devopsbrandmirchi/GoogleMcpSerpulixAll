import { createMcpHandler } from "mcp-handler";
import { APP_VERSION } from "@/lib/config";
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

function createInnerHandler() {
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
      registerDv360Tools(server);
    },
    {
      serverInfo: {
        name: "google-mcp-serpulix-all",
        version: APP_VERSION,
      },
      instructions:
        "This is a True Model B Google Marketing connector. Identify the operator with google_get_operator, list Google connections with google_connections_list, then use ga4_* tools for Analytics, ads_* tools for Google Ads, and dv360_* tools for Display & Video 360. The server routes each resource to the Google connection that owns it. Never invent resource IDs. DV360 is read-only. Google Ads queries are read-only; ads_create_campaign can create a paused Search campaign and budget when server write settings allow it. Always validate first, show the plan, and obtain explicit user approval before creation. Never automatically retry creation after an ambiguous timeout. If a connection is missing the DV360 scope, reconnect it with google_connections_start.",
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
