import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { connectUrl, issueConnectToken } from "@/providers/google/connect-token";
import { loadCurrentOperator } from "@/products/ga4/routing";
import { toToolErrorText } from "@/lib/errors";
import { jsonToolResult } from "@/mcp/tools/schemas";

export function registerStartConnectionTool(server: McpServer): void {
  server.registerTool(
    "google_connections_start",
    {
      title: "Connect another Google Account",
      description:
        "Creates a time-limited URL that starts an independent Google OAuth connection for the authenticated operator. Pass connectionId to reconnect the same Google account and grant newly required product scopes such as DV360. Open the URL in a browser.",
      inputSchema: z.object({
        connectionId: z.string().min(1).optional(),
      }),
    },
    async (input) => {
      try {
        const operator = await loadCurrentOperator();
        const token = issueConnectToken({
          operatorId: operator.operatorId,
          operation: input.connectionId ? "reconnect" : "add_connection",
          connectionId: input.connectionId,
        });
        return jsonToolResult({
          url: connectUrl(token),
          expiresInSeconds: 900,
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
