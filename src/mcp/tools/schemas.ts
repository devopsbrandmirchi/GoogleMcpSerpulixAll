import { z } from "zod";
import { isGa4Date } from "@/lib/dates";
import { normalizePropertyId } from "@/lib/property-id";
import { normalizeCustomerId } from "@/lib/customer-id";

export const propertyIdSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        normalizePropertyId(value);
        return true;
      } catch {
        return false;
      }
    },
    {
      message: "Use a numeric GA4 property ID such as 123456789.",
    },
  );

export const optionalPropertyIdSchema = propertyIdSchema.optional();

export const customerIdSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        normalizeCustomerId(value);
        return true;
      } catch {
        return false;
      }
    },
    {
      message: "Use a Google Ads customer ID such as 1234567890 or 123-456-7890.",
    },
  );

export const optionalCustomerIdSchema = customerIdSchema.optional();

export const connectionIdSchema = z.string().min(1).max(128);
export const optionalConnectionIdSchema = connectionIdSchema.optional();

export const ga4DateSchema = z.string().refine(isGa4Date, {
  message:
    "Use an ISO date (YYYY-MM-DD) or a GA4 relative value such as today, yesterday, or 30daysAgo.",
});

export const apiNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Use a GA4 API name such as activeUsers or country.");

export const dateRangeSchema = z.object({
  startDate: ga4DateSchema,
  endDate: ga4DateSchema,
});

const numericValueSchema = z.object({
  int64Value: z.string().optional(),
  doubleValue: z.number().optional(),
});

const filterSchema = z.object({
  fieldName: apiNameSchema,
  stringFilter: z
    .object({
      matchType: z
        .enum([
          "MATCH_TYPE_UNSPECIFIED",
          "EXACT",
          "BEGINS_WITH",
          "ENDS_WITH",
          "CONTAINS",
          "FULL_REGEXP",
          "PARTIAL_REGEXP",
        ])
        .optional(),
      value: z.string(),
      caseSensitive: z.boolean().optional(),
    })
    .optional(),
  inListFilter: z
    .object({
      values: z.array(z.string()).min(1),
      caseSensitive: z.boolean().optional(),
    })
    .optional(),
  numericFilter: z
    .object({
      operation: z.enum([
        "OPERATION_UNSPECIFIED",
        "EQUAL",
        "LESS_THAN",
        "LESS_THAN_OR_EQUAL",
        "GREATER_THAN",
        "GREATER_THAN_OR_EQUAL",
      ]),
      value: numericValueSchema,
    })
    .optional(),
  betweenFilter: z
    .object({
      fromValue: numericValueSchema,
      toValue: numericValueSchema,
    })
    .optional(),
});

export const filterExpressionSchema: z.ZodType = z.lazy(() =>
  z.object({
    andGroup: z
      .object({
        expressions: z.array(filterExpressionSchema),
      })
      .optional(),
    orGroup: z
      .object({
        expressions: z.array(filterExpressionSchema),
      })
      .optional(),
    notExpression: filterExpressionSchema.optional(),
    filter: filterSchema.optional(),
  }),
);

export const orderBySchema = z.object({
  desc: z.boolean().optional(),
  dimension: z
    .object({
      dimensionName: apiNameSchema,
      orderType: z
        .enum([
          "ORDER_TYPE_UNSPECIFIED",
          "ALPHANUMERIC",
          "CASE_INSENSITIVE_ALPHANUMERIC",
          "NUMERIC",
        ])
        .optional(),
    })
    .optional(),
  metric: z
    .object({
      metricName: apiNameSchema,
    })
    .optional(),
});

export const metadataInputSchema = z.object({
  propertyId: optionalPropertyIdSchema,
  connectionId: optionalConnectionIdSchema,
});

export const runReportInputSchema = z.object({
  propertyId: optionalPropertyIdSchema,
  connectionId: optionalConnectionIdSchema,
  dateRanges: z.array(dateRangeSchema).min(1).max(4),
  dimensions: z.array(apiNameSchema).max(9).default([]),
  metrics: z.array(apiNameSchema).min(1).max(10),
  dimensionFilter: filterExpressionSchema.optional(),
  metricFilter: filterExpressionSchema.optional(),
  orderBys: z.array(orderBySchema).max(10).optional(),
  limit: z.number().int().min(1).max(10000).default(1000),
  offset: z.number().int().min(0).max(100000).default(0),
});

export const realtimeReportInputSchema = z.object({
  propertyId: optionalPropertyIdSchema,
  connectionId: optionalConnectionIdSchema,
  dimensions: z.array(apiNameSchema).max(9).default([]),
  metrics: z.array(apiNameSchema).min(1).max(10),
  dimensionFilter: filterExpressionSchema.optional(),
  metricFilter: filterExpressionSchema.optional(),
  limit: z.number().int().min(1).max(10000).default(1000),
});

export const setActivePropertyInputSchema = z.object({
  propertyId: propertyIdSchema,
  connectionId: optionalConnectionIdSchema,
});

export const disconnectConnectionInputSchema = z.object({
  connectionId: connectionIdSchema,
});

export const adsQueryInputSchema = z.object({
  customerId: customerIdSchema,
  query: z.string().min(1).max(20000),
  connectionId: optionalConnectionIdSchema,
});

export const adsCustomerInputSchema = z.object({
  customerId: customerIdSchema,
  connectionId: optionalConnectionIdSchema,
});

export const adsReportingInputSchema = z.object({
  customerId: customerIdSchema,
  connectionId: optionalConnectionIdSchema,
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(10000).default(1000),
});

export const dv360IdSchema = z
  .string()
  .min(1)
  .regex(/^\d+$/, "Use a numeric DV360 ID such as 123456.");

export const dv360ListPartnersInputSchema = z.object({
  connectionId: optionalConnectionIdSchema,
});

export const dv360ListAdvertisersInputSchema = z.object({
  partnerId: dv360IdSchema.optional(),
  connectionId: optionalConnectionIdSchema,
});

export const dv360GetAdvertiserInputSchema = z.object({
  advertiserId: dv360IdSchema,
  connectionId: optionalConnectionIdSchema,
});

export const dv360PagedAdvertiserInputSchema = z.object({
  advertiserId: dv360IdSchema,
  connectionId: optionalConnectionIdSchema,
  pageSize: z.number().int().min(1).max(200).default(100),
  pageToken: z.string().min(1).optional(),
  filter: z.string().min(1).optional(),
  entityStatus: z.string().min(1).optional(),
  orderBy: z.string().min(1).optional(),
});

export function jsonToolResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}
