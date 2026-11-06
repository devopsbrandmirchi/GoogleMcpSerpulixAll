import { BetaAnalyticsDataClient, protos } from "@google-analytics/data";
import type { OAuth2Client } from "google-auth-library";
import { mapGoogleError } from "@/lib/errors";
import { normalizePropertyId, toPropertyResourceName } from "@/lib/property-id";

type IFilterExpression = protos.google.analytics.data.v1beta.IFilterExpression;
type IOrderBy = protos.google.analytics.data.v1beta.IOrderBy;
type IRow = protos.google.analytics.data.v1beta.IRow;
type IDimensionMetadata = protos.google.analytics.data.v1beta.IDimensionMetadata;
type IMetricMetadata = protos.google.analytics.data.v1beta.IMetricMetadata;

export interface DateRangeInput {
  startDate: string;
  endDate: string;
}

export interface RunReportInput {
  propertyId: string;
  dateRanges: DateRangeInput[];
  dimensions: string[];
  metrics: string[];
  dimensionFilter?: IFilterExpression;
  metricFilter?: IFilterExpression;
  orderBys?: IOrderBy[];
  limit?: number;
  offset?: number;
}

export interface RealtimeReportInput {
  propertyId: string;
  dimensions: string[];
  metrics: string[];
  dimensionFilter?: IFilterExpression;
  metricFilter?: IFilterExpression;
  limit?: number;
}

export interface NormalizedReport {
  propertyId: string;
  connectionId?: string;
  googleAccount?: string | null;
  dateRanges?: DateRangeInput[];
  dimensions: string[];
  metrics: string[];
  rows: Array<Record<string, string | number>>;
  rowCount: number;
}

export interface PropertyMetadata {
  propertyId: string;
  connectionId?: string;
  googleAccount?: string | null;
  dimensions: Array<{
    apiName: string;
    uiName: string;
    description: string;
    category: string;
    custom: boolean;
    deprecatedApiNames: string[];
  }>;
  metrics: Array<{
    apiName: string;
    uiName: string;
    description: string;
    category: string;
    custom: boolean;
    type: string;
    deprecatedApiNames: string[];
  }>;
}

export function createDataClient(auth: OAuth2Client): BetaAnalyticsDataClient {
  return new BetaAnalyticsDataClient({
    authClient: auth as never,
  });
}

function parseMetricValue(value: string | undefined): string | number {
  if (value === undefined || value === "") {
    return "";
  }
  if (/^-?\d+$/.test(value)) {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value;
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return Number(value);
  }
  return value;
}

export function normalizeRows(
  rows: IRow[] | null | undefined,
  dimensions: string[],
  metrics: string[],
): Array<Record<string, string | number>> {
  return (rows ?? []).map((row) => {
    const result: Record<string, string | number> = {};
    dimensions.forEach((dimension, index) => {
      result[dimension] = row.dimensionValues?.[index]?.value ?? "";
    });
    metrics.forEach((metric, index) => {
      result[metric] = parseMetricValue(row.metricValues?.[index]?.value ?? undefined);
    });
    return result;
  });
}

function mapDimensionMetadata(item: IDimensionMetadata) {
  return {
    apiName: item.apiName ?? "",
    uiName: item.uiName ?? "",
    description: item.description ?? "",
    category: item.category ?? "",
    custom: Boolean(item.customDefinition),
    deprecatedApiNames: item.deprecatedApiNames ?? [],
  };
}

function mapMetricMetadata(item: IMetricMetadata) {
  return {
    apiName: item.apiName ?? "",
    uiName: item.uiName ?? "",
    description: item.description ?? "",
    category: item.category ?? "",
    custom: Boolean(item.customDefinition),
    type: String(item.type ?? "METRIC_TYPE_UNSPECIFIED"),
    deprecatedApiNames: item.deprecatedApiNames ?? [],
  };
}

export async function getPropertyMetadata(
  propertyId: string,
  auth: OAuth2Client,
  clientFactory: (authClient: OAuth2Client) => BetaAnalyticsDataClient = createDataClient,
): Promise<PropertyMetadata> {
  try {
    const client = clientFactory(auth);
    const [response] = await client.getMetadata({
      name: `${toPropertyResourceName(propertyId)}/metadata`,
    });

    return {
      propertyId: normalizePropertyId(propertyId),
      dimensions: (response.dimensions ?? []).map(mapDimensionMetadata),
      metrics: (response.metrics ?? []).map(mapMetricMetadata),
    };
  } catch (error) {
    throw mapGoogleError(error, "ga4");
  }
}

export async function runGa4Report(
  input: RunReportInput,
  auth: OAuth2Client,
  clientFactory: (authClient: OAuth2Client) => BetaAnalyticsDataClient = createDataClient,
): Promise<NormalizedReport> {
  try {
    const client = clientFactory(auth);
    const [response] = await client.runReport({
      property: toPropertyResourceName(input.propertyId),
      dateRanges: input.dateRanges,
      dimensions: input.dimensions.map((name) => ({ name })),
      metrics: input.metrics.map((name) => ({ name })),
      dimensionFilter: input.dimensionFilter,
      metricFilter: input.metricFilter,
      orderBys: input.orderBys,
      limit: input.limit,
      offset: input.offset,
    });

    const rows = normalizeRows(response.rows, input.dimensions, input.metrics);
    return {
      propertyId: normalizePropertyId(input.propertyId),
      dateRanges: input.dateRanges,
      dimensions: input.dimensions,
      metrics: input.metrics,
      rows,
      rowCount: Number(response.rowCount ?? rows.length),
    };
  } catch (error) {
    throw mapGoogleError(error, "ga4");
  }
}

export async function runGa4RealtimeReport(
  input: RealtimeReportInput,
  auth: OAuth2Client,
  clientFactory: (authClient: OAuth2Client) => BetaAnalyticsDataClient = createDataClient,
): Promise<NormalizedReport> {
  try {
    const client = clientFactory(auth);
    const [response] = await client.runRealtimeReport({
      property: toPropertyResourceName(input.propertyId),
      dimensions: input.dimensions.map((name) => ({ name })),
      metrics: input.metrics.map((name) => ({ name })),
      dimensionFilter: input.dimensionFilter,
      metricFilter: input.metricFilter,
      limit: input.limit,
    });

    const rows = normalizeRows(response.rows, input.dimensions, input.metrics);
    return {
      propertyId: normalizePropertyId(input.propertyId),
      dimensions: input.dimensions,
      metrics: input.metrics,
      rows,
      rowCount: Number(response.rowCount ?? rows.length),
    };
  } catch (error) {
    throw mapGoogleError(error, "ga4");
  }
}
