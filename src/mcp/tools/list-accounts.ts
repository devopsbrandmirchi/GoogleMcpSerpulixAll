import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { listOperatorAccounts, loadCurrentOperator } from "@/products/ga4/routing";
import { toToolErrorText } from "@/lib/errors";
import { jsonToolResult, optionalConnectionIdSchema } from "@/mcp/tools/schemas";

export function registerListAccountsTool(server: McpServer): void {
  server.registerTool(
    "ga4_list_accounts",
    {
      title: "List GA4 accounts",
      description:
        "Lists discovered GA4 accounts for the authenticated operator, including the owning Google connection.",
      inputSchema: z.object({
        connectionId: optionalConnectionIdSchema,
      }),
    },
    async (input) => {
      try {
        const operator = await loadCurrentOperator();
        const accounts = await listOperatorAccounts(operator.operatorId, input.connectionId);
        return jsonToolResult({ accounts, count: accounts.length });
      } catch (error) {
        return {
          content: [{ type: "text", text: toToolErrorText(error) }],
          isError: true,
        };
      }
    },
  );
}
