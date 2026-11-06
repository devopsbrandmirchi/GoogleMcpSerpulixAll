import type { McpServer } from "@modelcontextprotocol/server";
import { protos } from "@google-analytics/data";
import { runGa4Report } from "@/products/ga4/api/data";
import { resolveAuthorizedProperty } from "@/products/ga4/routing";
import { toToolErrorText } from "@/lib/errors";
import { jsonToolResult, runReportInputSchema } from "@/mcp/tools/schemas";

type IFilterExpression = protos.google.analytics.data.v1beta.IFilterExpression;
type IOrderBy = protos.google.analytics.data.v1beta.IOrderBy;

export const RUN_REPORT_DESCRIPTION = `What it does: the general-purpose historical GA4 Data API reporting tool.

When to use: yesterday's users, last 30 days users/sessions, top countries, top landing pages, traffic sources, conversions/key events, daily active users, this month vs last month (two dateRanges). Do not use this for "right now" questions.

Required parameters: dateRanges (startDate/endDate), metrics.
Optional parameters: propertyId (defaults to the active property), connectionId (required only if the same property exists on two connections), dimensions, dimensionFilter, metricFilter, orderBys, limit (default 1000, max 10000), offset.

The server resolves propertyId to the Google connection that has access and uses that connection's OAuth credential.

Returns: a clean table of rows with dimension and metric values, plus rowCount, connectionId, and googleAccount.

Limitations: dates are passed to GA4 unchanged. Never invent a property ID.`;

export function registerRunReportTool(server: McpServer): void {
  server.registerTool(
    "ga4_run_report",
    {
      title: "Run GA4 report",
      description: RUN_REPORT_DESCRIPTION,
      inputSchema: runReportInputSchema,
    },
    async (input) => {
      try {
        const property = await resolveAuthorizedProperty(input.propertyId, input.connectionId);
        const report = await runGa4Report(
          {
            propertyId: property.propertyId,
            dateRanges: input.dateRanges,
            dimensions: input.dimensions,
            metrics: input.metrics,
            dimensionFilter: input.dimensionFilter as IFilterExpression | undefined,
            metricFilter: input.metricFilter as IFilterExpression | undefined,
            orderBys: input.orderBys as IOrderBy[] | undefined,
            limit: input.limit,
            offset: input.offset,
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
