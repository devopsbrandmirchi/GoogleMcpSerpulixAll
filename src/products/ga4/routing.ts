import type { OAuth2Client } from "google-auth-library";
import { AppError } from "@/lib/errors";
import { getOperatorContext, getSessionId } from "@/lib/request-context";
import { getAuthorizedClientForConnection } from "@/providers/google/auth";
import { createAdminClient, fetchGa4PropertyCreateTime, discoverGa4Resources } from "@/products/ga4/api/admin";
import { normalizePropertyId } from "@/lib/property-id";
import { getAppStore } from "@/store/app-store";
import type { Ga4PropertyRecord, GoogleConnectionRecord, SessionRecord } from "@/store/types";

export interface ResolvedProperty {
  product: "ga4";
  propertyId: string;
  propertyName: string;
  account: string;
  propertyType: string;
  connectionId: string;
  googleEmail: string | null;
  ga4AccountId: string;
  connection: GoogleConnectionRecord;
  client: OAuth2Client;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function loadCurrentOperator() {
  const { operatorId } = getOperatorContext();
  const operator = await getAppStore().getOperator(operatorId);
  if (!operator) {
    throw new AppError("The authenticated operator was not found.", "operator_not_found", 401);
  }
  return operator;
}

export async function requireActiveConnections(operatorId: string): Promise<GoogleConnectionRecord[]> {
  const connections = (await getAppStore().listConnections(operatorId)).filter(
    (item) => item.status !== "disconnected",
  );
  if (connections.length === 0) {
    throw new AppError(
      "No Google Account is connected to this operator. Please connect a Google Account first.",
      "no_google_connections",
      400,
    );
  }
  return connections;
}

export async function persistDiscoveredGa4Resources(
  operatorId: string,
  connectionId: string,
  client: OAuth2Client,
): Promise<void> {
  const discovered = await discoverGa4Resources(client);
  await getAppStore().replaceConnectionResources(
    operatorId,
    connectionId,
    discovered.accounts,
    discovered.properties,
  );
}

export async function refreshOperatorPropertyCreationDates(operatorId: string, connectionId?: string) {
  const store = getAppStore();
  const connections = await requireActiveConnections(operatorId);
  const targets = connections.filter((item) => !connectionId || item.connectionId === connectionId);
  if (connectionId && targets.length === 0) {
    throw new AppError("Google connection not found.", "connection_not_found", 404);
  }
  const result = { updated: 0, unavailable: 0, failed: 0 };
  for (const connection of targets) {
    const properties = await store.listProperties(operatorId, connection.connectionId);
    if (properties.length === 0) continue;
    let adminClient: ReturnType<typeof createAdminClient>;
    try {
      const auth = await getAuthorizedClientForConnection(operatorId, connection.connectionId);
      adminClient = createAdminClient(auth);
    } catch {
      result.failed += properties.length;
      continue;
    }
    for (const property of properties) {
      try {
        const date = await fetchGa4PropertyCreateTime(adminClient, property.propertyId);
        if (date) {
          await store.updatePropertyCreateTime(operatorId, connection.connectionId, property.propertyId, date);
          result.updated++;
        } else {
          result.unavailable++;
        }
      } catch {
        result.failed++;
      }
    }
  }
  return result;
}

export async function listOperatorProperties(operatorId: string, connectionId?: string) {
  const store = getAppStore();
  const [properties, connections] = await Promise.all([
    store.listProperties(operatorId, connectionId),
    store.listConnections(operatorId),
  ]);
  const session = await store.getSession(getSessionId());
  const connectionMap = new Map(connections.map((item) => [item.connectionId, item]));

  return properties.map((property) => {
    const connection = connectionMap.get(property.connectionId);
    return {
      connectionId: property.connectionId,
      googleAccount: connection?.googleEmail ?? null,
      ga4AccountId: property.ga4AccountId,
      propertyId: property.propertyId,
      propertyName: property.displayName,
      propertyType: property.propertyType,
      propertyCreateTime: property.propertyCreateTime ?? null,
      isActive:
        session?.activePropertyId === property.propertyId &&
        session.activeConnectionId === property.connectionId,
    };
  });
}

export async function listOperatorAccounts(operatorId: string, connectionId?: string) {
  const store = getAppStore();
  const [accounts, connections] = await Promise.all([
    store.listAccounts(operatorId, connectionId),
    store.listConnections(operatorId),
  ]);
  const connectionMap = new Map(connections.map((item) => [item.connectionId, item]));
  return accounts.map((account) => ({
    connectionId: account.connectionId,
    googleAccount: connectionMap.get(account.connectionId)?.googleEmail ?? null,
    ga4AccountId: account.ga4AccountId,
    displayName: account.displayName,
  }));
}

async function persistSessionProperty(
  operatorId: string,
  property: Ga4PropertyRecord,
  connection: GoogleConnectionRecord,
): Promise<SessionRecord> {
  const existing = await getAppStore().getSession(getSessionId());
  return getAppStore().upsertSession({
    sessionId: getSessionId(),
    operatorId,
    activeConnectionId: connection.connectionId,
    activePropertyId: property.propertyId,
    activePropertyName: property.displayName,
    activePropertyAccount: property.ga4AccountId,
    activeAdsCustomerId: existing?.activeAdsCustomerId ?? null,
    activeAdsConnectionId: existing?.activeAdsConnectionId ?? null,
    updatedAt: nowIso(),
  });
}

export async function resolveAuthorizedProperty(
  requestedPropertyId?: string,
  requestedConnectionId?: string,
): Promise<ResolvedProperty> {
  const { operatorId } = getOperatorContext();
  const store = getAppStore();
  await requireActiveConnections(operatorId);

  if (requestedConnectionId) {
    await getAuthorizedClientForConnection(operatorId, requestedConnectionId);
  }

  const propertyId = requestedPropertyId ? normalizePropertyId(requestedPropertyId) : undefined;
  let matches = propertyId
    ? await store.findPropertiesByPropertyId(operatorId, propertyId)
    : [];

  if (requestedConnectionId) {
    matches = matches.filter((item) => item.connectionId === requestedConnectionId);
  }

  if (propertyId && matches.length === 0) {
    throw new AppError("The requested GA4 property was not found.", "property_not_found", 404);
  }

  if (propertyId && matches.length > 1) {
    throw new AppError(
      "The requested GA4 property is available through more than one Google connection. Specify connectionId.",
      "property_ambiguous",
      409,
    );
  }

  const session = await store.getSession(getSessionId());
  let selected = matches[0];
  if (!selected && session?.activePropertyId && session.activeConnectionId) {
    const activeMatches = await store.findPropertiesByPropertyId(
      operatorId,
      session.activePropertyId,
    );
    selected = activeMatches.find((item) => item.connectionId === session.activeConnectionId);
    if (!selected) {
      throw new AppError(
        "The previously selected GA4 property is no longer accessible. List properties and select another.",
        "active_property_unavailable",
        409,
      );
    }
  }

  if (!selected) {
    throw new AppError(
      "No active GA4 property is selected. List properties and set one first.",
      "no_active_property",
      400,
    );
  }

  const connection = await store.getConnection(selected.connectionId);
  if (!connection || connection.operatorId !== operatorId) {
    throw new AppError(
      "The requested GA4 property is not accessible through the selected Google connection.",
      "property_not_accessible",
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
  if (
    session?.activePropertyId !== selected.propertyId ||
    session.activeConnectionId !== selected.connectionId
  ) {
    await persistSessionProperty(operatorId, selected, connection);
  }

  return {
    product: "ga4",
    propertyId: selected.propertyId,
    propertyName: selected.displayName,
    account: selected.ga4AccountId,
    propertyType: selected.propertyType,
    connectionId: connection.connectionId,
    googleEmail: connection.googleEmail,
    ga4AccountId: selected.ga4AccountId,
    connection,
    client,
  };
}

export async function setActiveProperty(propertyId: string, connectionId?: string) {
  return resolveAuthorizedProperty(propertyId, connectionId);
}
