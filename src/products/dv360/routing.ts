import type { OAuth2Client } from "google-auth-library";
import { AppError } from "@/lib/errors";
import { getOperatorContext } from "@/lib/request-context";
import { DV360_SCOPE } from "@/lib/config";
import { logger } from "@/lib/logger";
import { connectionHasScope, getAuthorizedClientForConnection } from "@/providers/google/auth";
import { discoverDv360Resources } from "@/products/dv360/discovery";
import { requireActiveConnections } from "@/products/ga4/routing";
import { getAppStore } from "@/store/app-store";
import type {
  Dv360AdvertiserRecord,
  Dv360PartnerRecord,
  GoogleConnectionRecord,
} from "@/store/types";

export interface ResolvedDv360Access {
  product: "dv360";
  partnerId: string;
  advertiserId?: string;
  displayName: string;
  connectionId: string;
  googleEmail: string | null;
  connection: GoogleConnectionRecord;
  client: OAuth2Client;
}

export function normalizeDv360Id(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new AppError(`Use a numeric ${label} such as 123456.`, "validation", 400);
  }
  return trimmed;
}

export const DV360_EMPTY_ACCESS_HINT =
  "This Google connection authorized the DV360 OAuth scope, but the Display & Video 360 API returned no partners or advertisers. Scope is not the same as a DV360 user seat. Add this Google user to a DV360 partner, or connect the Google account that actually owns the partner.";

export async function persistDiscoveredDv360Resources(
  operatorId: string,
  connectionId: string,
  client: OAuth2Client,
): Promise<void> {
  const discovered = await discoverDv360Resources(client);
  await getAppStore().replaceDv360Resources(
    operatorId,
    connectionId,
    discovered.partners,
    discovered.advertisers,
  );
}

function requireDv360Scope(connection: GoogleConnectionRecord): void {
  if (!connectionHasScope(connection, DV360_SCOPE)) {
    throw new AppError(
      `The Google connection for ${connection.googleEmail ?? "this account"} is not authorized for DV360. Reconnect it with google_connections_start and pass this connectionId.`,
      "reauthorization_required",
      401,
    );
  }
}

function assertUsableConnection(
  operatorId: string,
  connection: GoogleConnectionRecord | undefined,
): GoogleConnectionRecord {
  if (!connection || connection.operatorId !== operatorId) {
    throw new AppError(
      "The requested DV360 resource is not accessible through the selected Google connection.",
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
  requireDv360Scope(connection);
  return connection;
}

function pickDeterministic<T extends { connectionId: string }>(matches: T[]): T {
  return [...matches].sort((left, right) => left.connectionId.localeCompare(right.connectionId))[0]!;
}

async function loadOwnedConnection(
  operatorId: string,
  connectionId: string,
): Promise<GoogleConnectionRecord> {
  const connection = await getAppStore().getConnection(connectionId);
  return assertUsableConnection(operatorId, connection);
}

export async function resolveDv360PartnerAccess(
  requestedPartnerId?: string,
  requestedConnectionId?: string,
): Promise<ResolvedDv360Access> {
  const { operatorId, requestId } = getOperatorContext();
  const store = getAppStore();
  await requireActiveConnections(operatorId);

  if (requestedConnectionId) {
    await loadOwnedConnection(operatorId, requestedConnectionId);
  }

  const partnerId = requestedPartnerId ? normalizeDv360Id(requestedPartnerId, "DV360 partner ID") : undefined;
  let matches = partnerId ? await store.findDv360PartnersByPartnerId(operatorId, partnerId) : [];
  if (requestedConnectionId) {
    matches = matches.filter((item) => item.connectionId === requestedConnectionId);
  }

  if (partnerId && matches.length === 0) {
    throw new AppError(
      "The requested DV360 partner is not accessible to this operator.",
      "resource_not_accessible",
      403,
    );
  }

  const selected = matches.length > 1 ? pickDeterministic(matches) : matches[0];
  if (!selected) {
    throw new AppError(
      "No DV360 partner is selected. List partners and specify partnerId.",
      "validation",
      400,
    );
  }

  if (matches.length > 1 && !requestedConnectionId) {
    logger.info("Resolved DV360 partner across multiple connections", {
      requestId,
      operatorId,
      partnerId: selected.partnerId,
      connectionId: selected.connectionId,
    });
  }

  const connection = assertUsableConnection(
    operatorId,
    await store.getConnection(selected.connectionId),
  );
  const client = await getAuthorizedClientForConnection(operatorId, connection.connectionId);
  return {
    product: "dv360",
    partnerId: selected.partnerId,
    displayName: selected.displayName,
    connectionId: connection.connectionId,
    googleEmail: connection.googleEmail,
    connection,
    client,
  };
}

export async function resolveDv360AdvertiserAccess(
  requestedAdvertiserId?: string,
  requestedConnectionId?: string,
): Promise<ResolvedDv360Access> {
  const { operatorId, requestId } = getOperatorContext();
  const store = getAppStore();
  await requireActiveConnections(operatorId);

  if (requestedConnectionId) {
    await loadOwnedConnection(operatorId, requestedConnectionId);
  }

  const advertiserId = requestedAdvertiserId
    ? normalizeDv360Id(requestedAdvertiserId, "DV360 advertiser ID")
    : undefined;
  let matches = advertiserId
    ? await store.findDv360AdvertisersByAdvertiserId(operatorId, advertiserId)
    : [];
  if (requestedConnectionId) {
    matches = matches.filter((item) => item.connectionId === requestedConnectionId);
  }

  if (advertiserId && matches.length === 0) {
    throw new AppError(
      "The requested DV360 advertiser is not accessible to this operator.",
      "resource_not_accessible",
      403,
    );
  }

  const selected = matches.length > 1 ? pickDeterministic(matches) : matches[0];
  if (!selected) {
    throw new AppError(
      "No DV360 advertiser is selected. List advertisers and specify advertiserId.",
      "validation",
      400,
    );
  }

  if (matches.length > 1 && !requestedConnectionId) {
    logger.info("Resolved DV360 advertiser across multiple connections", {
      requestId,
      operatorId,
      advertiserId: selected.advertiserId,
      connectionId: selected.connectionId,
    });
  }

  const connection = assertUsableConnection(
    operatorId,
    await store.getConnection(selected.connectionId),
  );
  const client = await getAuthorizedClientForConnection(operatorId, connection.connectionId);
  return {
    product: "dv360",
    partnerId: selected.partnerId,
    advertiserId: selected.advertiserId,
    displayName: selected.displayName,
    connectionId: connection.connectionId,
    googleEmail: connection.googleEmail,
    connection,
    client,
  };
}

export async function refreshDv360DiscoveryIfEmpty(
  operatorId: string,
  connectionId?: string,
): Promise<void> {
  const store = getAppStore();
  const existingPartners = await store.listDv360Partners(operatorId, connectionId);
  const existingAdvertisers = await store.listDv360Advertisers(operatorId, connectionId);
  if (existingPartners.length > 0 || existingAdvertisers.length > 0) {
    return;
  }

  const connections = (await store.listConnections(operatorId)).filter((connection) => {
    if (connectionId && connection.connectionId !== connectionId) {
      return false;
    }
    return (
      connection.status === "active" &&
      connectionHasScope(connection, DV360_SCOPE) &&
      Boolean(connection.refreshTokenEncrypted)
    );
  });

  for (const connection of connections) {
    try {
      const client = await getAuthorizedClientForConnection(operatorId, connection.connectionId);
      await persistDiscoveredDv360Resources(operatorId, connection.connectionId, client);
    } catch (error) {
      logger.warn("DV360 live rediscovery failed", {
        operatorId,
        connectionId: connection.connectionId,
        errorCategory: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}

export async function listAccessibleDv360Partners(operatorId: string, connectionId?: string) {
  await refreshDv360DiscoveryIfEmpty(operatorId, connectionId);
  const store = getAppStore();
  const [partners, connections] = await Promise.all([
    store.listDv360Partners(operatorId, connectionId),
    store.listConnections(operatorId),
  ]);
  const connectionMap = new Map(connections.map((item) => [item.connectionId, item]));
  return partners
    .slice()
    .sort((left, right) => {
      if (left.connectionId !== right.connectionId) {
        return left.connectionId.localeCompare(right.connectionId);
      }
      return left.partnerId.localeCompare(right.partnerId);
    })
    .map((partner) => toPartnerView(partner, connectionMap.get(partner.connectionId)));
}

export async function listAccessibleDv360Advertisers(
  operatorId: string,
  options?: { connectionId?: string; partnerId?: string },
) {
  const store = getAppStore();
  const partnerId = options?.partnerId
    ? normalizeDv360Id(options.partnerId, "DV360 partner ID")
    : undefined;
  await refreshDv360DiscoveryIfEmpty(operatorId, options?.connectionId);
  const [advertisers, connections] = await Promise.all([
    store.listDv360Advertisers(operatorId, options?.connectionId),
    store.listConnections(operatorId),
  ]);
  const connectionMap = new Map(connections.map((item) => [item.connectionId, item]));
  return advertisers
    .filter((item) => !partnerId || item.partnerId === partnerId)
    .sort((left, right) => {
      if (left.connectionId !== right.connectionId) {
        return left.connectionId.localeCompare(right.connectionId);
      }
      if (left.partnerId !== right.partnerId) {
        return left.partnerId.localeCompare(right.partnerId);
      }
      return left.advertiserId.localeCompare(right.advertiserId);
    })
    .map((advertiser) => toAdvertiserView(advertiser, connectionMap.get(advertiser.connectionId)));
}

function toPartnerView(partner: Dv360PartnerRecord, connection?: GoogleConnectionRecord) {
  return {
    connectionId: partner.connectionId,
    googleAccount: connection?.googleEmail ?? null,
    partnerId: partner.partnerId,
    displayName: partner.displayName,
    entityStatus: partner.entityStatus,
    currencyCode: partner.currencyCode,
    timeZone: partner.timeZone,
  };
}

function toAdvertiserView(
  advertiser: Dv360AdvertiserRecord,
  connection?: GoogleConnectionRecord,
) {
  return {
    connectionId: advertiser.connectionId,
    googleAccount: connection?.googleEmail ?? null,
    partnerId: advertiser.partnerId,
    advertiserId: advertiser.advertiserId,
    displayName: advertiser.displayName,
    entityStatus: advertiser.entityStatus,
    currencyCode: advertiser.currencyCode,
    timeZone: advertiser.timeZone,
  };
}
