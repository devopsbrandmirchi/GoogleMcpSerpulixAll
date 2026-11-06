import type { McpServer } from "@modelcontextprotocol/server";
import { protos } from "@google-analytics/data";
import { runGa4RealtimeReport } from "@/products/ga4/api/data";
import { resolveAuthorizedProperty } from "@/products/ga4/routing";
import { toToolErrorText } from "@/lib/errors";
import { jsonToolResult, realtimeReportInputSchema } from "@/mcp/tools/schemas";

type IFilterExpression = protos.google.analytics.data.v1beta.IFilterExpression;

export function registerRealtimeTool(server: McpServer): void {
  server.registerTool(
    "ga4_run_realtime_report",
    {
      title: "Run GA4 realtime report",
      description:
        "Runs a GA4 realtime Data API report for an authorized property. Use for 'right now' questions, not historical dates.",
      inputSchema: realtimeReportInputSchema,
    },
    async (input) => {
      try {
        const property = await resolveAuthorizedProperty(input.propertyId, input.connectionId);
        const report = await runGa4RealtimeReport(
          {
            propertyId: property.propertyId,
            dimensions: input.dimensions,
            metrics: input.metrics,
            dimensionFilter: input.dimensionFilter as IFilterExpression | undefined,
            metricFilter: input.metricFilter as IFilterExpression | undefined,
            limit: input.limit,
          },
          property.client,
        );
        return jsonToolResult({
          ...report,
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
