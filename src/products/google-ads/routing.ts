import type { OAuth2Client } from "google-auth-library";
import { AppError } from "@/lib/errors";
import { normalizeCustomerId } from "@/lib/customer-id";
import { getOperatorContext, getSessionId } from "@/lib/request-context";
import { logger } from "@/lib/logger";
import { GOOGLE_ADS_SCOPE } from "@/lib/config";
import { connectionHasScope, getAuthorizedClientForConnection } from "@/providers/google/auth";
import { discoverAdsResources } from "@/products/google-ads/discovery";
import { requireActiveConnections } from "@/products/ga4/routing";
import { getAppStore } from "@/store/app-store";
import type { AdsCustomerRecord, GoogleConnectionRecord } from "@/store/types";

export interface ResolvedAdsAccess {
  product: "google_ads";
  customerId: string;
  loginCustomerId: string | null;
  managerCustomerId: string | null;
  isManager: boolean;
  directlyAccessible: boolean;
  connectionId: string;
  googleEmail: string | null;
  descriptiveName: string;
  connection: GoogleConnectionRecord;
  client: OAuth2Client;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function persistDiscoveredAdsResources(
  operatorId: string,
  connectionId: string,
  client: OAuth2Client,
): Promise<void> {
  const discovered = await discoverAdsResources(client);
  await getAppStore().replaceAdsResources(
    operatorId,
    connectionId,
    discovered.customers,
    discovered.edges,
  );
}

function pickDeterministicCustomer(matches: AdsCustomerRecord[]): AdsCustomerRecord {
  const sorted = [...matches].sort((left, right) => {
    if (left.directlyAccessible !== right.directlyAccessible) {
      return left.directlyAccessible ? -1 : 1;
    }
    if (left.level !== right.level) {
      return left.level - right.level;
    }
    const leftLogin = left.loginCustomerId ?? "";
    const rightLogin = right.loginCustomerId ?? "";
    if (leftLogin !== rightLogin) {
      return leftLogin.localeCompare(rightLogin);
    }
    return left.connectionId.localeCompare(right.connectionId);
  });
  return sorted[0]!;
}

export async function resolveAdsAccessContext(
  requestedCustomerId?: string,
  requestedConnectionId?: string,
): Promise<ResolvedAdsAccess> {
  const { operatorId, requestId } = getOperatorContext();
  const store = getAppStore();
  await requireActiveConnections(operatorId);

  if (requestedConnectionId) {
    await getAuthorizedClientForConnection(operatorId, requestedConnectionId);
  }

  const customerId = requestedCustomerId ? normalizeCustomerId(requestedCustomerId) : undefined;
  let matches = customerId
    ? await store.findAdsCustomersByCustomerId(operatorId, customerId)
    : [];

  if (requestedConnectionId) {
    matches = matches.filter((item) => item.connectionId === requestedConnectionId);
  }

  if (customerId && matches.length === 0) {
    throw new AppError(
      "The requested Google Ads customer is not accessible to this operator.",
      "resource_not_accessible",
      403,
    );
  }

  const session = await store.getSession(getSessionId());
  let selected = matches.length > 1 ? pickDeterministicCustomer(matches) : matches[0];

  if (customerId && matches.length > 1 && !requestedConnectionId) {
    logger.info("Resolved Ads customer across multiple hierarchies", {
      requestId,
      operatorId,
      customerId,
      connectionId: selected?.connectionId,
      loginCustomerId: selected?.loginCustomerId,
    });
  }

  if (!selected && session?.activeAdsCustomerId && session.activeAdsConnectionId) {
    const activeMatches = await store.findAdsCustomersByCustomerId(
      operatorId,
      session.activeAdsCustomerId,
    );
    selected = activeMatches.find((item) => item.connectionId === session.activeAdsConnectionId);
  }

  if (!selected) {
    throw new AppError(
      "No Google Ads customer is selected. List accessible accounts and specify customerId.",
      "validation",
      400,
    );
  }

  const connection = await store.getConnection(selected.connectionId);
  if (!connection || connection.operatorId !== operatorId) {
    throw new AppError(
      "The requested Google Ads customer is not accessible through the selected Google connection.",
      "resource_not_accessible",
      403,
    );
  }
  if (connection.status === "disconnected") {
    throw new AppError("This Google connection has been disconnected.", "not_connected", 401);
  }
  if (connection.status === "reauthorization_required" || connection.status === "revoked") {
    throw new AppError(
      `The Google connection for ${connection.googleEmail ?? "this account"} requires reauthorization.`,
      "reauthorization_required",
      401,
    );
  }

  const client = await getAuthorizedClientForConnection(operatorId, connection.connectionId);
  const loginCustomerId = selected.directlyAccessible ? null : selected.loginCustomerId;

  if (
    session?.activeAdsCustomerId !== selected.customerId ||
    session.activeAdsConnectionId !== selected.connectionId
  ) {
    await store.upsertSession({
      sessionId: getSessionId(),
      operatorId,
      activeConnectionId: session?.activeConnectionId ?? null,
      activePropertyId: session?.activePropertyId ?? null,
      activePropertyName: session?.activePropertyName ?? null,
      activePropertyAccount: session?.activePropertyAccount ?? null,
      activeAdsCustomerId: selected.customerId,
      activeAdsConnectionId: selected.connectionId,
      updatedAt: nowIso(),
    });
  }

  return {
    product: "google_ads",
    customerId: selected.customerId,
    loginCustomerId,
    managerCustomerId: loginCustomerId,
    isManager: selected.manager,
    directlyAccessible: selected.directlyAccessible,
    connectionId: connection.connectionId,
    googleEmail: connection.googleEmail,
    descriptiveName: selected.descriptiveName,
    connection,
    client,
  };
}

export async function refreshAdsDiscoveryIfEmpty(
  operatorId: string,
  connectionId?: string,
): Promise<void> {
  const store = getAppStore();
  const existing = await store.listAdsCustomers(operatorId, connectionId);
  if (existing.length > 0) {
    return;
  }

  const connections = (await store.listConnections(operatorId)).filter((connection) => {
    if (connectionId && connection.connectionId !== connectionId) {
      return false;
    }
    return (
      connection.status === "active" &&
      connectionHasScope(connection, GOOGLE_ADS_SCOPE) &&
      Boolean(connection.refreshTokenEncrypted)
    );
  });

  let lastError: unknown;
  for (const connection of connections) {
    try {
      const client = await getAuthorizedClientForConnection(operatorId, connection.connectionId);
      await persistDiscoveredAdsResources(operatorId, connection.connectionId, client);
    } catch (error) {
      lastError = error;
      logger.warn("Google Ads live rediscovery failed", {
        operatorId,
        connectionId: connection.connectionId,
        errorCategory: error instanceof Error ? error.name : "unknown",
        errorMessage: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  const refreshed = await store.listAdsCustomers(operatorId, connectionId);
  if (refreshed.length === 0 && lastError) {
    throw lastError;
  }
}

export async function listAccessibleAdsAccounts(operatorId: string, connectionId?: string) {
  await refreshAdsDiscoveryIfEmpty(operatorId, connectionId);
  const store = getAppStore();
  const [customers, connections] = await Promise.all([
    store.listAdsCustomers(operatorId, connectionId),
    store.listConnections(operatorId),
  ]);
  const connectionMap = new Map(connections.map((item) => [item.connectionId, item]));
  return customers
    .slice()
    .sort((left, right) => {
      if (left.connectionId !== right.connectionId) {
        return left.connectionId.localeCompare(right.connectionId);
      }
      if (left.level !== right.level) {
        return left.level - right.level;
      }
      return left.customerId.localeCompare(right.customerId);
    })
    .map((customer) => ({
      connectionId: customer.connectionId,
      googleAccount: connectionMap.get(customer.connectionId)?.googleEmail ?? null,
      customerId: customer.customerId,
      name: customer.descriptiveName,
      manager: customer.manager,
      directlyAccessible: customer.directlyAccessible,
      parentCustomerId: customer.parentCustomerId,
      level: customer.level,
      status: customer.status,
      currencyCode: customer.currencyCode,
      timeZone: customer.timeZone,
    }));
}
