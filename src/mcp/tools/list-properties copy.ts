import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { listOperatorProperties, loadCurrentOperator } from "@/products/ga4/routing";
import { toToolErrorText } from "@/lib/errors";
import { jsonToolResult, optionalConnectionIdSchema } from "@/mcp/tools/schemas";

export function registerListPropertiesTool(server: McpServer): void {
  server.registerTool(
    "ga4_list_properties",
    {
      title: "List GA4 properties",
      description:
        "Lists discovered GA4 properties for the authenticated operator. Each property includes the Google connection that owns it.",
      inputSchema: z.object({
        connectionId: optionalConnectionIdSchema,
      }),
    },
    async (input) => {
      try {
        const operator = await loadCurrentOperator();
        const properties = await listOperatorProperties(operator.operatorId, input.connectionId);
        return jsonToolResult({ properties, count: properties.length });
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );
}
