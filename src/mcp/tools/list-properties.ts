import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { listOperatorProperties, loadCurrentOperator, refreshOperatorPropertyCreationDates } from "@/products/ga4/routing";
import { toToolErrorText } from "@/lib/errors";
import { jsonToolResult, optionalConnectionIdSchema } from "@/mcp/tools/schemas";

export function registerListPropertiesTool(server: McpServer): void {
  server.registerTool(
    "ga4_list_properties",
    {
      title: "List GA4 properties",
      description:
        "Lists GA4 properties with their original Google creation timestamps (propertyCreateTime). Set refreshCreationDates=true to fetch timestamps for existing properties using saved Google authorization; failures leave existing records intact.",
      inputSchema: z.object({
        connectionId: optionalConnectionIdSchema,
        refreshCreationDates: z.boolean().optional().default(false),
      }),
    },
    async (input) => {
      try {
        const operator = await loadCurrentOperator();
        const refresh = input.refreshCreationDates
          ? await refreshOperatorPropertyCreationDates(operator.operatorId, input.connectionId)
          : undefined;
        const properties = await listOperatorProperties(operator.operatorId, input.connectionId);
        return jsonToolResult({ properties, count: properties.length, ...(refresh ? { refresh } : {}) });
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );
}
