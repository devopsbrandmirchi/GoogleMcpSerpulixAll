const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RELATIVE_DATE = /^(today|yesterday|\d+daysAgo)$/;

export function isGa4Date(value: string): boolean {
  return ISO_DATE.test(value) || RELATIVE_DATE.test(value);
}

export function assertGa4Date(value: string, fieldName: string): string {
  if (!isGa4Date(value)) {
    throw new Error(
      `Invalid ${fieldName} "${value}". Use an ISO date (YYYY-MM-DD) or a GA4 relative value such as today, yesterday, or 30daysAgo.`,
    );
  }
  return value;
}
