import { getConfig } from "@/lib/config";
import { AppError, mapGoogleError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { GOOGLE_ADS_API_BASE } from "@/products/google-ads/api/version";

export interface AdsRequestOptions {
  path: string;
  method?: "GET" | "POST";
  accessToken: string;
  loginCustomerId?: string | null;
  body?: unknown;
}

export interface AdsJsonResponse {
  status: number;
  requestId: string | null;
  body: unknown;
}

function developerToken(): string {
  return getConfig().googleAdsDeveloperToken;
}

export async function adsRequest(options: AdsRequestOptions): Promise<AdsJsonResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
    "developer-token": developerToken(),
    "Content-Type": "application/json",
  };
  if (options.loginCustomerId) {
    headers["login-customer-id"] = options.loginCustomerId;
  }

  const response = await fetch(`${GOOGLE_ADS_API_BASE}${options.path}`, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const requestId =
    response.headers.get("request-id") ??
    response.headers.get("x-request-id") ??
    response.headers.get("Request-Id");

  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { message: text };
    }
  }

  if (!response.ok) {
    const message =
      (body &&
        typeof body === "object" &&
        "error" in body &&
        typeof (body as { error?: { message?: string } }).error?.message === "string"
        ? (body as { error: { message: string } }).error.message
        : `Google Ads API request failed with status ${response.status}`) ??
      "Google Ads API request failed.";
    logger.error("Google Ads API error", {
      status: response.status,
      requestId,
      googleMessage: message,
      errorCategory: "google_ads_api_error",
    });
    throw mapGoogleError(
      {
        status: response.status,
        message,
        requestId: requestId ?? undefined,
      },
      "ads",
    );
  }

  return { status: response.status, requestId, body };
}

export async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const response = await adsRequest({
    path: "/customers:listAccessibleCustomers",
    method: "GET",
    accessToken,
  });
  const resourceNames =
    response.body &&
    typeof response.body === "object" &&
    "resourceNames" in response.body &&
    Array.isArray((response.body as { resourceNames?: unknown }).resourceNames)
      ? ((response.body as { resourceNames: unknown[] }).resourceNames)
      : [];
  return resourceNames
    .filter((item): item is string => typeof item === "string")
    .map((name) => name.replace(/^customers\//, ""));
}

export async function searchGoogleAds(params: {
  customerId: string;
  query: string;
  accessToken: string;
  loginCustomerId?: string | null;
  pageToken?: string;
}): Promise<{ results: unknown[]; nextPageToken?: string; requestId: string | null }> {
  const response = await adsRequest({
    path: `/customers/${params.customerId}/googleAds:search`,
    method: "POST",
    accessToken: params.accessToken,
    loginCustomerId: params.loginCustomerId,
    body: {
      query: params.query,
      pageToken: params.pageToken,
    },
  });
  const payload = (response.body ?? {}) as { results?: unknown[]; nextPageToken?: string };
  return {
    results: Array.isArray(payload.results) ? payload.results : [],
    nextPageToken: payload.nextPageToken,
    requestId: response.requestId,
  };
}

export async function searchGoogleAdsAll(params: {
  customerId: string;
  query: string;
  accessToken: string;
  loginCustomerId?: string | null;
  maxPages?: number;
}): Promise<{ results: unknown[]; requestId: string | null }> {
  const results: unknown[] = [];
  let pageToken: string | undefined;
  let lastRequestId: string | null = null;
  const maxPages = params.maxPages ?? 20;
  for (let page = 0; page < maxPages; page += 1) {
    const batch = await searchGoogleAds({
      ...params,
      pageToken,
    });
    lastRequestId = batch.requestId;
    results.push(...batch.results);
    if (!batch.nextPageToken) {
      break;
    }
    pageToken = batch.nextPageToken;
  }
  return { results, requestId: lastRequestId };
}

export function requireAccessToken(token?: string | null): string {
  if (!token) {
    throw new AppError(
      "The Google connection did not produce an access token.",
      "reauthorization_required",
      401,
    );
  }
  return token;
}
