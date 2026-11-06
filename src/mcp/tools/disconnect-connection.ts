import type { McpServer } from "@modelcontextprotocol/server";
import {
  assertConnectionOwned,
  clearAccessTokenCache,
  publicConnectionView,
} from "@/providers/google/auth";
import { loadCurrentOperator } from "@/products/ga4/routing";
import { toToolErrorText } from "@/lib/errors";
import { disconnectConnectionInputSchema, jsonToolResult } from "@/mcp/tools/schemas";
import { getAppStore } from "@/store/app-store";

export function registerDisconnectConnectionTool(server: McpServer): void {
  server.registerTool(
    "google_connections_disconnect",
    {
      title: "Disconnect a Google connection",
      description:
        "Disconnects a Google OAuth connection owned by the authenticated operator and deletes the stored refresh token.",
      inputSchema: disconnectConnectionInputSchema,
    },
    async (input) => {
      try {
        const operator = await loadCurrentOperator();
        await assertConnectionOwned(operator.operatorId, input.connectionId);
        const connection = await getAppStore().disconnectConnection(
          operator.operatorId,
          input.connectionId,
        );
        clearAccessTokenCache(input.connectionId);
        return jsonToolResult({
          disconnected: true,
          connection: publicConnectionView(connection),
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
