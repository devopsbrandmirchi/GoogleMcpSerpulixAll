import { z } from "zod";
import { customerIdSchema, optionalConnectionIdSchema } from "@/mcp/tools/schemas";

export const microsSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/, "Use a positive integer in micros (1000000 = one currency unit).");

export const numericIdSchema = z.string().regex(/^\d+$/, "Use a numeric Google Ads ID.");

export const compositeIdSchema = z
  .string()
  .regex(/^\d+~\d+$/, "Use the composite ID adGroupId~id, for example 123~456.");

export const statusSchema = z.enum(["ENABLED", "PAUSED"]);

export const euPoliticalSchema = z.enum([
  "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
  "CONTAINS_EU_POLITICAL_ADVERTISING",
]);

export const writeBaseShape = {
  customerId: customerIdSchema,
  connectionId: optionalConnectionIdSchema,
  validateOnly: z.boolean().default(true),
  confirm: z.boolean().default(false),
};

export function resourceName(customerId: string, collection: string, id: string | number): string {
  return `customers/${customerId}/${collection}/${id}`;
}

export function textAssets(texts: string[]): Array<{ text: string }> {
  return texts.map((text) => ({ text }));
}
