import type { McpServer } from "@modelcontextprotocol/server";
import { setActiveProperty } from "@/products/ga4/routing";
import { toToolErrorText } from "@/lib/errors";
import { jsonToolResult, setActivePropertyInputSchema } from "@/mcp/tools/schemas";

export function registerSetActivePropertyTool(server: McpServer): void {
  server.registerTool(
    "ga4_set_active_property",
    {
      title: "Set active GA4 property",
      description:
        "Sets the session default GA4 property. The server resolves the Google connection that owns the property.",
      inputSchema: setActivePropertyInputSchema,
    },
    async (input) => {
      try {
        const property = await setActiveProperty(input.propertyId, input.connectionId);
        return jsonToolResult({
          propertyId: property.propertyId,
          propertyName: property.propertyName,
          connectionId: property.connectionId,
          googleAccount: property.googleEmail,
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
