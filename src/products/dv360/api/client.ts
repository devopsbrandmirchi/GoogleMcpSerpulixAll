import { AppError, mapGoogleError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { DV360_API_BASE } from "@/products/dv360/api/version";

export interface Dv360RequestOptions {
  path: string;
  accessToken: string;
  query?: Record<string, string | number | undefined>;
}

export interface Dv360JsonResponse {
  status: number;
  requestId: string | null;
  body: unknown;
}

export interface Dv360ListPage<T> {
  items: T[];
  nextPageToken?: string;
  requestId: string | null;
}

const DEFAULT_MAX_PAGES = 20;

function buildQuery(query?: Record<string, string | number | undefined>): string {
  if (!query) {
    return "";
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") {
      continue;
    }
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

export async function dv360Request(options: Dv360RequestOptions): Promise<Dv360JsonResponse> {
  const response = await fetch(`${DV360_API_BASE}${options.path}${buildQuery(options.query)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      Accept: "application/json",
    },
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
        : `Display & Video 360 API request failed with status ${response.status}`) ??
      "Display & Video 360 API request failed.";
    logger.error("DV360 API error", {
      status: response.status,
      requestId,
      errorCategory: "google_dv360_api_error",
    });
    throw mapGoogleError(
      {
        status: response.status,
        message,
        requestId: requestId ?? undefined,
      },
      "dv360",
    );
  }

  return { status: response.status, requestId, body };
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

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

function nextToken(body: unknown): string | undefined {
  if (body && typeof body === "object" && "nextPageToken" in body) {
    const token = (body as { nextPageToken?: unknown }).nextPageToken;
    return typeof token === "string" && token.length > 0 ? token : undefined;
  }
  return undefined;
}

export async function listDv360Collection(params: {
  path: string;
  accessToken: string;
  itemsKey: string;
  pageSize?: number;
  pageToken?: string;
  filter?: string;
  orderBy?: string;
  extraQuery?: Record<string, string | number | undefined>;
}): Promise<Dv360ListPage<Record<string, unknown>>> {
  const response = await dv360Request({
    path: params.path,
    accessToken: params.accessToken,
    query: {
      pageSize: params.pageSize,
      pageToken: params.pageToken,
      filter: params.filter,
      orderBy: params.orderBy,
      ...params.extraQuery,
    },
  });
  const body = (response.body ?? {}) as Record<string, unknown>;
  return {
    items: asRecordArray(body[params.itemsKey]),
    nextPageToken: nextToken(response.body),
    requestId: response.requestId,
  };
}

export async function listDv360CollectionAll(params: {
  path: string;
  accessToken: string;
  itemsKey: string;
  extraQuery?: Record<string, string | number | undefined>;
  maxPages?: number;
}): Promise<{ items: Record<string, unknown>[]; requestId: string | null }> {
  const items: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  let lastRequestId: string | null = null;
  const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES;
  for (let page = 0; page < maxPages; page += 1) {
    const batch = await listDv360Collection({
      path: params.path,
      accessToken: params.accessToken,
      itemsKey: params.itemsKey,
      pageToken,
      extraQuery: params.extraQuery,
    });
    lastRequestId = batch.requestId;
    items.push(...batch.items);
    if (!batch.nextPageToken) {
      break;
    }
    pageToken = batch.nextPageToken;
  }
  return { items, requestId: lastRequestId };
}

export async function getDv360Resource(params: {
  path: string;
  accessToken: string;
}): Promise<{ resource: Record<string, unknown>; requestId: string | null }> {
  const response = await dv360Request({
    path: params.path,
    accessToken: params.accessToken,
  });
  return {
    resource:
      response.body && typeof response.body === "object"
        ? (response.body as Record<string, unknown>)
        : {},
    requestId: response.requestId,
  };
}

export function listFilter(params: { filter?: string; entityStatus?: string }): string | undefined {
  if (params.filter?.trim()) {
    return params.filter.trim();
  }
  if (params.entityStatus?.trim()) {
    return `entityStatus="${params.entityStatus.trim()}"`;
  }
  return undefined;
}
