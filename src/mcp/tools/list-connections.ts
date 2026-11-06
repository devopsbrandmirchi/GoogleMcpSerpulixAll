import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { publicConnectionView } from "@/providers/google/auth";
import { loadCurrentOperator } from "@/products/ga4/routing";
import { toToolErrorText } from "@/lib/errors";
import { jsonToolResult } from "@/mcp/tools/schemas";
import { getAppStore } from "@/store/app-store";

export function registerListConnectionsTool(server: McpServer): void {
  server.registerTool(
    "google_connections_list",
    {
      title: "List Google connections",
      description:
        "Lists Google OAuth connections owned by the authenticated MCP operator, including which products (GA4, Google Ads, DV360) each connection authorized. Never returns tokens.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const operator = await loadCurrentOperator();
        const connections = await getAppStore().listConnections(operator.operatorId);
        return jsonToolResult({
          connections: connections.map(publicConnectionView),
          count: connections.length,
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
