import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { loadCurrentOperator } from "@/products/ga4/routing";
import { toToolErrorText } from "@/lib/errors";
import { peekOperatorContext } from "@/lib/request-context";
import { jsonToolResult } from "@/mcp/tools/schemas";
import { getAppStore } from "@/store/app-store";

export const GET_OPERATOR_DESCRIPTION = `What it does: returns the authenticated MCP operator for this Claude connector session.

When to use: to confirm which operator is connected before listing Google connections, GA4 properties, or Google Ads accounts.

Required parameters: none.

Returns: operatorId, connectionCount, and connected=true. Never returns tokens or credentials.`;

export function registerGetOperatorTool(server: McpServer): void {
  server.registerTool(
    "google_get_operator",
    {
      title: "Get authenticated operator",
      description: GET_OPERATOR_DESCRIPTION,
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const operator = await loadCurrentOperator();
        const context = peekOperatorContext();
        const connections = await getAppStore().listConnections(operator.operatorId);
        return jsonToolResult({
          operatorId: operator.operatorId,
          connectionCount: connections.filter((item) => item.status !== "disconnected").length,
          connected: connections.some((item) => item.status === "active"),
          requestId: context?.requestId,
        });
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );
}
