import { AppError } from "@/lib/errors";

const CUSTOMER_RESOURCE = /^customers\/(\d+)$/;

export function normalizeCustomerId(input: string): string {
  const trimmed = input.trim();
  const resourceMatch = trimmed.match(CUSTOMER_RESOURCE);
  const raw = resourceMatch?.[1] ?? trimmed.replaceAll("-", "").replaceAll(" ", "");
  if (!/^\d{8,12}$/.test(raw)) {
    throw new AppError(
      `Invalid Google Ads customer ID "${input}". Use digits only, or a hyphenated ID such as 123-456-7890.`,
      "invalid_customer_id",
      400,
    );
  }
  return raw;
}

export function toCustomerResourceName(input: string): string {
  return `customers/${normalizeCustomerId(input)}`;
}
