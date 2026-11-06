import type { McpServer } from "@modelcontextprotocol/server";
import { getPropertyMetadata } from "@/products/ga4/api/data";
import { resolveAuthorizedProperty } from "@/products/ga4/routing";
import { toToolErrorText } from "@/lib/errors";
import { jsonToolResult, metadataInputSchema } from "@/mcp/tools/schemas";

export function registerMetadataTool(server: McpServer): void {
  server.registerTool(
    "ga4_get_metadata",
    {
      title: "Get GA4 property metadata",
      description:
        "Returns available dimensions and metrics for an authorized GA4 property. Uses the Google connection that owns the property.",
      inputSchema: metadataInputSchema,
    },
    async (input) => {
      try {
        const property = await resolveAuthorizedProperty(input.propertyId, input.connectionId);
        const metadata = await getPropertyMetadata(property.propertyId, property.client);
        return jsonToolResult({
          ...metadata,
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
