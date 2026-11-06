import type { OAuth2Client } from "google-auth-library";
import { logger } from "@/lib/logger";
import { normalizeCustomerId } from "@/lib/customer-id";
import {
  listAccessibleCustomers,
  requireAccessToken,
  searchGoogleAdsAll,
} from "@/products/google-ads/api/client";
import type { DiscoveredAdsCustomer, DiscoveredAdsEdge } from "@/store/types";

const CUSTOMER_CLIENT_QUERY = `
  SELECT
    customer_client.client_customer,
    customer_client.level,
    customer_client.manager,
    customer_client.descriptive_name,
    customer_client.currency_code,
    customer_client.time_zone,
    customer_client.id,
    customer_client.status
  FROM customer_client
  WHERE customer_client.level <= 1
`.trim();

const CUSTOMER_QUERY = `
  SELECT
    customer.id,
    customer.descriptive_name,
    customer.currency_code,
    customer.time_zone,
    customer.manager,
    customer.status
  FROM customer
  LIMIT 1
`.trim();

interface CustomerClientRow {
  customerClient?: {
    clientCustomer?: string;
    level?: string | number;
    manager?: boolean;
    descriptiveName?: string;
    currencyCode?: string;
    timeZone?: string;
    id?: string | number;
    status?: string;
  };
}

interface CustomerRow {
  customer?: {
    id?: string | number;
    descriptiveName?: string;
    currencyCode?: string;
    timeZone?: string;
    manager?: boolean;
    status?: string;
  };
}

function asCustomerId(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return normalizeCustomerId(String(value));
  } catch {
    return undefined;
  }
}

function upsertCustomer(
  map: Map<string, DiscoveredAdsCustomer>,
  next: DiscoveredAdsCustomer,
): void {
  const existing = map.get(next.customerId);
  if (!existing) {
    map.set(next.customerId, next);
    return;
  }
  const managers = new Set([...existing.accessibleManagerIds, ...next.accessibleManagerIds]);
  const loginCustomerId =
    existing.loginCustomerId && next.loginCustomerId
      ? pickPreferredLogin(existing, next)
      : existing.loginCustomerId ?? next.loginCustomerId;
  map.set(next.customerId, {
    ...existing,
    ...next,
    descriptiveName: next.descriptiveName || existing.descriptiveName,
    directlyAccessible: existing.directlyAccessible || next.directlyAccessible,
    accessibleManagerIds: [...managers].sort(),
    loginCustomerId,
    level: Math.min(existing.level, next.level),
    parentCustomerId: existing.parentCustomerId ?? next.parentCustomerId,
  });
}

function pickPreferredLogin(left: DiscoveredAdsCustomer, right: DiscoveredAdsCustomer): string {
  if (left.level !== right.level) {
    return left.level < right.level ? left.loginCustomerId! : right.loginCustomerId!;
  }
  return [left.loginCustomerId!, right.loginCustomerId!].sort()[0]!;
}

export async function discoverAdsResources(
  client: OAuth2Client,
): Promise<{ customers: DiscoveredAdsCustomer[]; edges: DiscoveredAdsEdge[] }> {
  const accessToken = requireAccessToken((await client.getAccessToken()).token);
  const accessible = await listAccessibleCustomers(accessToken);
  const customers = new Map<string, DiscoveredAdsCustomer>();
  const edges: DiscoveredAdsEdge[] = [];
  const visitedManagers = new Set<string>();

  for (const customerId of accessible) {
    let details: CustomerRow["customer"] | undefined;
    try {
      const { results } = await searchGoogleAdsAll({
        customerId,
        query: CUSTOMER_QUERY,
        accessToken,
        loginCustomerId: customerId,
      });
      details = (results[0] as CustomerRow | undefined)?.customer;
    } catch (error) {
      logger.warn("Could not load accessible Ads customer details", {
        customerId,
        errorCategory: error instanceof Error ? error.name : "unknown",
      });
    }

    upsertCustomer(customers, {
      customerId,
      descriptiveName: details?.descriptiveName ?? customerId,
      currencyCode: details?.currencyCode ?? null,
      timeZone: details?.timeZone ?? null,
      status: details?.status ?? "UNKNOWN",
      manager: Boolean(details?.manager),
      directlyAccessible: true,
      loginCustomerId: null,
      accessibleManagerIds: [],
      level: 0,
      parentCustomerId: null,
    });
  }

  async function walkManager(managerId: string, loginCustomerId: string): Promise<void> {
    const visitKey = `${loginCustomerId}:${managerId}`;
    if (visitedManagers.has(visitKey)) {
      return;
    }
    visitedManagers.add(visitKey);

    let results: unknown[] = [];
    try {
      const response = await searchGoogleAdsAll({
        customerId: managerId,
        query: CUSTOMER_CLIENT_QUERY,
        accessToken,
        loginCustomerId,
      });
      results = response.results;
    } catch (error) {
      logger.warn("Could not load Ads manager hierarchy", {
        managerId,
        errorCategory: error instanceof Error ? error.name : "unknown",
      });
      return;
    }

    for (const row of results as CustomerClientRow[]) {
      const child = row.customerClient;
      const childId = asCustomerId(child?.id ?? child?.clientCustomer);
      if (!childId || childId === managerId) {
        continue;
      }
      const level = Number(child?.level ?? 1);
      edges.push({
        managerCustomerId: managerId,
        clientCustomerId: childId,
        level,
      });
      upsertCustomer(customers, {
        customerId: childId,
        descriptiveName: child?.descriptiveName ?? childId,
        currencyCode: child?.currencyCode ?? null,
        timeZone: child?.timeZone ?? null,
        status: child?.status ?? "UNKNOWN",
        manager: Boolean(child?.manager),
        directlyAccessible: accessible.includes(childId),
        loginCustomerId: accessible.includes(childId) ? null : loginCustomerId,
        accessibleManagerIds: accessible.includes(childId) ? [] : [loginCustomerId],
        level,
        parentCustomerId: managerId,
      });
      if (child?.manager) {
        await walkManager(childId, loginCustomerId);
      }
    }
  }

  for (const managerId of accessible) {
    const record = customers.get(managerId);
    if (record?.manager || !record) {
      await walkManager(managerId, managerId);
    }
  }

  return {
    customers: [...customers.values()],
    edges,
  };
}
