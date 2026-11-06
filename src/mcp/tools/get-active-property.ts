import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { loadCurrentOperator } from "@/products/ga4/routing";
import { toToolErrorText } from "@/lib/errors";
import { getSessionId } from "@/lib/request-context";
import { jsonToolResult } from "@/mcp/tools/schemas";
import { getAppStore } from "@/store/app-store";

export function registerGetActivePropertyTool(server: McpServer): void {
  server.registerTool(
    "ga4_get_active_property",
    {
      title: "Get active GA4 property",
      description: "Returns the session default GA4 property and the Google connection that owns it.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        await loadCurrentOperator();
        const session = await getAppStore().getSession(getSessionId());
        return jsonToolResult({
          propertyId: session?.activePropertyId ?? null,
          propertyName: session?.activePropertyName ?? null,
          ga4AccountId: session?.activePropertyAccount ?? null,
          connectionId: session?.activeConnectionId ?? null,
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
