export type AppErrorCode =
  | "not_connected"
  | "invalid_property"
  | "invalid_field"
  | "quota"
  | "revoked"
  | "unauthorized"
  | "validation"
  | "google_api"
  | "no_active_property"
  | "active_property_unavailable"
  | "property_not_accessible"
  | "operator_not_found"
  | "session_invalid"
  | "reauthorization_required"
  | "connection_not_found"
  | "connection_forbidden"
  | "no_google_connections"
  | "property_ambiguous"
  | "property_not_found"
  | "authentication_error"
  | "authorization_error"
  | "resource_not_accessible"
  | "google_oauth_error"
  | "google_ads_api_error"
  | "google_dv360_api_error"
  | "ga4_api_error"
  | "invalid_customer_id"
  | "invalid_property_id"
  | "customer_ambiguous"
  | "customer_not_found"
  | "advertiser_not_found"
  | "partner_not_found"
  | "rate_limited"
  | "configuration_error"
  | "internal_error"
  | "invalid_query";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly googleRequestId?: string;

  constructor(
    message: string,
    code: AppErrorCode,
    status = 400,
    extras?: { googleRequestId?: string },
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = toHttpStatus(status);
    this.googleRequestId = extras?.googleRequestId;
  }
}

export function toHttpStatus(status: number, fallback = 500): number {
  if (Number.isInteger(status) && status >= 200 && status <= 599) {
    return status;
  }
  return fallback;
}

interface GoogleLikeError {
  code?: number | string;
  status?: number | string;
  message?: string;
  details?: unknown;
  requestId?: string;
}

function asGoogleError(error: unknown): GoogleLikeError {
  if (error && typeof error === "object") {
    return error as GoogleLikeError;
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

function combinedMessage(error: GoogleLikeError): string {
  const parts = [error.message];
  if (typeof error.details === "string") {
    parts.push(error.details);
  }
  return parts.filter(Boolean).join(" ");
}

export function mapGoogleError(
  error: unknown,
  product: "ga4" | "ads" | "dv360" | "oauth" = "ga4",
): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const googleError = asGoogleError(error);
  const numericCode =
    typeof googleError.code === "number"
      ? googleError.code
      : typeof googleError.status === "number"
        ? googleError.status
        : Number.parseInt(String(googleError.code ?? googleError.status ?? ""), 10);
  const message = combinedMessage(googleError);
  const lower = message.toLowerCase();
  const requestId = googleError.requestId;

  if (
    lower.includes("invalid_grant") ||
    lower.includes("token has been expired or revoked") ||
    lower.includes("invalid refresh token")
  ) {
    return new AppError(
      "The Google connection requires reauthorization.",
      "reauthorization_required",
      401,
      { googleRequestId: requestId },
    );
  }

  if (numericCode === 401 || lower.includes("unauthenticated")) {
    return new AppError(
      "No Google Account is connected to this operator. Please connect a Google Account first.",
      "not_connected",
      401,
      { googleRequestId: requestId },
    );
  }

  if (
    numericCode === 403 &&
    (lower.includes("permission") ||
      lower.includes("access") ||
      lower.includes("not found") ||
      lower.includes("insufficient") ||
      lower.includes("user_permission_denied"))
  ) {
    return new AppError(
      product === "ads"
        ? "The requested Google Ads customer is not accessible through the selected Google connection."
        : product === "dv360"
          ? "The requested DV360 resource is not accessible through the selected Google connection."
          : "The requested GA4 property is not accessible through the selected Google connection.",
      product === "ads" || product === "dv360" ? "resource_not_accessible" : "property_not_accessible",
      403,
      { googleRequestId: requestId },
    );
  }

  if (numericCode === 429 || lower.includes("quota") || lower.includes("rate limit")) {
    return new AppError(
      product === "ads"
        ? "The Google Ads API quota or rate limit was exceeded. Wait and try again."
        : product === "dv360"
          ? "The Display & Video 360 API quota or rate limit was exceeded. Wait and try again."
          : "The Google Analytics API quota or rate limit was exceeded. Wait and try again.",
      "rate_limited",
      429,
      { googleRequestId: requestId },
    );
  }

  const fieldMatch =
    message.match(/(?:metric|dimension)\s+['"`]([A-Za-z0-9_]+)['"`]/i) ??
    message.match(/['"`]([A-Za-z][A-Za-z0-9_]{2,})['"`]/);
  if (
    product === "ga4" &&
    numericCode === 400 &&
    (lower.includes("metric") ||
      lower.includes("dimension") ||
      lower.includes("invalid argument") ||
      fieldMatch)
  ) {
    const field = fieldMatch?.[1];
    return new AppError(
      field
        ? `Google Analytics rejected the request because "${field}" is not a valid metric or dimension for this property.`
        : `Google Analytics rejected a metric or dimension in the request. ${message}`,
      "invalid_field",
      400,
    );
  }

  if (numericCode === 404 || lower.includes("property not found") || lower.includes("not found")) {
    return new AppError(
      product === "ads"
        ? "The requested Google Ads customer was not found."
        : product === "dv360"
          ? "The requested DV360 resource was not found."
          : "The requested GA4 property was not found.",
      product === "ads"
        ? "customer_not_found"
        : product === "dv360"
          ? "advertiser_not_found"
          : "property_not_found",
      404,
      { googleRequestId: requestId },
    );
  }

  const code: AppErrorCode =
    product === "ads"
      ? "google_ads_api_error"
      : product === "dv360"
        ? "google_dv360_api_error"
        : product === "oauth"
          ? "google_oauth_error"
          : "ga4_api_error";
  return new AppError(
    message ||
      (product === "ads"
        ? "The Google Ads API request failed."
        : product === "dv360"
          ? "The Display & Video 360 API request failed."
          : "The Google Analytics API request failed."),
    code,
    toHttpStatus(numericCode),
    { googleRequestId: requestId },
  );
}

export function toToolErrorText(error: unknown): string {
  const mapped = mapGoogleError(error);
  return JSON.stringify({
    error: mapped.code,
    message: mapped.message,
  });
}
