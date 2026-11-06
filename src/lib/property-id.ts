import { AppError } from "@/lib/errors";

const PROPERTY_RESOURCE = /^properties\/(\d+)$/;
const NUMERIC_ID = /^\d+$/;

export function normalizePropertyId(input: string): string {
  const trimmed = input.trim();
  const resourceMatch = trimmed.match(PROPERTY_RESOURCE);
  if (resourceMatch?.[1]) {
    return resourceMatch[1];
  }
  if (NUMERIC_ID.test(trimmed)) {
    return trimmed;
  }
  throw new AppError(
    `Invalid GA4 property ID "${input}". Use a numeric ID such as 123456789.`,
    "invalid_property_id",
    400,
  );
}

export function toPropertyResourceName(input: string): string {
  return `properties/${normalizePropertyId(input)}`;
}
