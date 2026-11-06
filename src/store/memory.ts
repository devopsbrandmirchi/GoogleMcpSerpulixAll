import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import type {
  AdsCustomerRecord,
  AdsHierarchyEdgeRecord,
  AppStore,
  ConnectionStatus,
  DiscoveredAccount,
  DiscoveredAdsCustomer,
  DiscoveredAdsEdge,
  DiscoveredDv360Advertiser,
  DiscoveredDv360Partner,
  DiscoveredProperty,
  Dv360AdvertiserRecord,
  Dv360PartnerRecord,
  Ga4AccountRecord,
  Ga4PropertyRecord,
  GoogleConnectionRecord,
  OAuthTransactionRecord,
  OperatorRecord,
  SessionRecord,
  UpsertConnectionInput,
} from "@/store/types";
import { connectionUniqueKey, hierarchyEdgeId, resourceDocId } from "@/store/types";

function nowIso(): string {
  return new Date().toISOString();
}

export function createMemoryAppStore(): AppStore {
  const operators = new Map<string, OperatorRecord>();
  const connections = new Map<string, GoogleConnectionRecord>();
  const uniques = new Map<string, string>();
  const accounts = new Map<string, Ga4AccountRecord>();
  const properties = new Map<string, Ga4PropertyRecord>();
  const adsCustomers = new Map<string, AdsCustomerRecord>();
  const adsEdges = new Map<string, AdsHierarchyEdgeRecord>();
  const dv360Partners = new Map<string, Dv360PartnerRecord>();
  const dv360Advertisers = new Map<string, Dv360AdvertiserRecord>();
  const transactions = new Map<string, OAuthTransactionRecord>();
  const sessions = new Map<string, SessionRecord>();

  return {
    async createOperator(primaryEmail = null) {
      const timestamp = nowIso();
      const record: OperatorRecord = {
        operatorId: randomUUID(),
        primaryEmail,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastAccessAt: timestamp,
      };
      operators.set(record.operatorId, record);
      return record;
    },

    async getOperator(operatorId) {
      return operators.get(operatorId);
    },

    async touchLastAccess(operatorId) {
      const existing = operators.get(operatorId);
      if (!existing) {
        return;
      }
      operators.set(operatorId, { ...existing, lastAccessAt: nowIso() });
    },

    async getConnection(connectionId) {
      return connections.get(connectionId);
    },

    async getConnectionForOperatorGoogle(operatorId, googleSubjectId) {
      const connectionId = uniques.get(connectionUniqueKey(operatorId, googleSubjectId));
      return connectionId ? connections.get(connectionId) : undefined;
    },

    async listConnections(operatorId) {
      return [...connections.values()].filter((item) => item.operatorId === operatorId);
    },

    async listConnectionsByGoogleSubject(googleSubjectId) {
      return [...connections.values()].filter((item) => item.googleSubjectId === googleSubjectId);
    },

    async upsertConnection(input: UpsertConnectionInput) {
      const unique = connectionUniqueKey(input.operatorId, input.googleSubjectId);
      const existingId = uniques.get(unique);
      const existing = existingId ? connections.get(existingId) : undefined;
      if (existing && input.connectionId && input.connectionId !== existing.connectionId) {
        throw new AppError(
          "This Google account is already connected for this operator.",
          "validation",
          409,
        );
      }

      const timestamp = nowIso();
      const nextToken = input.encryptedRefreshToken || existing?.refreshTokenEncrypted || null;
      if (!nextToken) {
        throw new AppError(
          "Google did not return a refresh token. Revoke this app in Google Account permissions and authorize again.",
          "revoked",
          400,
        );
      }

      const record: GoogleConnectionRecord = {
        connectionId: existing?.connectionId ?? input.connectionId ?? randomUUID(),
        operatorId: input.operatorId,
        googleSubjectId: input.googleSubjectId,
        googleEmail: input.googleEmail ?? existing?.googleEmail ?? null,
        googleDisplayName: input.googleDisplayName ?? existing?.googleDisplayName ?? null,
        refreshTokenEncrypted: nextToken,
        scopes: input.scopes ?? existing?.scopes ?? [],
        status: "active",
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        lastUsedAt: existing?.lastUsedAt ?? null,
        lastSyncedAt: existing?.lastSyncedAt ?? null,
      };
      connections.set(record.connectionId, record);
      uniques.set(unique, record.connectionId);
      return record;
    },

    async markConnectionStatus(connectionId, status: ConnectionStatus, extra) {
      const existing = connections.get(connectionId);
      if (!existing) {
        throw new AppError("The requested Google connection was not found.", "connection_not_found", 404);
      }
      const next: GoogleConnectionRecord = {
        ...existing,
        status,
        updatedAt: nowIso(),
        lastUsedAt: extra?.lastUsedAt ?? existing.lastUsedAt,
        lastSyncedAt: extra?.lastSyncedAt ?? existing.lastSyncedAt,
      };
      connections.set(connectionId, next);
      return next;
    },

    async disconnectConnection(operatorId, connectionId) {
      const existing = connections.get(connectionId);
      if (!existing || existing.operatorId !== operatorId) {
        throw new AppError(
          "The requested Google connection was not found.",
          "connection_not_found",
          404,
        );
      }
      const next: GoogleConnectionRecord = {
        ...existing,
        refreshTokenEncrypted: null,
        status: "disconnected",
        updatedAt: nowIso(),
      };
      connections.set(connectionId, next);
      return next;
    },

    async replaceConnectionResources(operatorId, connectionId, discoveredAccounts, discoveredProperties) {
      const timestamp = nowIso();
      for (const [id, account] of accounts) {
        if (account.connectionId === connectionId) {
          accounts.delete(id);
        }
      }
      const previousProperties = new Map([...properties].filter(([, record]) => record.connectionId === connectionId));
      for (const [id] of previousProperties) {
        properties.delete(id);
      }
      for (const account of discoveredAccounts as DiscoveredAccount[]) {
        const id = resourceDocId(connectionId, account.ga4AccountId);
        accounts.set(id, {
          id,
          connectionId,
          operatorId,
          ga4AccountId: account.ga4AccountId,
          displayName: account.displayName,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastSyncedAt: timestamp,
        });
      }
      for (const property of discoveredProperties as DiscoveredProperty[]) {
        const id = resourceDocId(connectionId, property.propertyId);
        properties.set(id, {
          id,
          connectionId,
          operatorId,
          ga4AccountId: property.ga4AccountId,
          propertyId: property.propertyId,
          displayName: property.displayName,
          propertyType: property.propertyType,
          propertyCreateTime: property.propertyCreateTime ?? previousProperties.get(id)?.propertyCreateTime ?? null,
          createdAt: previousProperties.get(id)?.createdAt ?? timestamp,
          updatedAt: timestamp,
          lastSyncedAt: timestamp,
        });
      }
      const connection = connections.get(connectionId);
      if (connection) {
        connections.set(connectionId, {
          ...connection,
          lastSyncedAt: timestamp,
          updatedAt: timestamp,
        });
      }
    },

    async updatePropertyCreateTime(operatorId, connectionId, propertyId, propertyCreateTime) {
      const id = resourceDocId(connectionId, propertyId);
      const record = properties.get(id);
      if (!record || record.operatorId !== operatorId || record.connectionId !== connectionId) {
        throw new AppError("Property not found for this operator and connection.", "property_not_found", 404);
      }
      properties.set(id, { ...record, propertyCreateTime, updatedAt: nowIso() });
    },

    async listAccounts(operatorId, connectionId) {
      return [...accounts.values()].filter(
        (item) =>
          item.operatorId === operatorId && (!connectionId || item.connectionId === connectionId),
      );
    },

    async listProperties(operatorId, connectionId) {
      return [...properties.values()].filter(
        (item) =>
          item.operatorId === operatorId && (!connectionId || item.connectionId === connectionId),
      );
    },

    async findPropertiesByPropertyId(operatorId, propertyId) {
      return [...properties.values()].filter(
        (item) => item.operatorId === operatorId && item.propertyId === propertyId,
      );
    },

    async replaceAdsResources(operatorId, connectionId, customers, edges) {
      const timestamp = nowIso();
      for (const [id, customer] of adsCustomers) {
        if (customer.connectionId === connectionId) {
          adsCustomers.delete(id);
        }
      }
      for (const [id, edge] of adsEdges) {
        if (edge.connectionId === connectionId) {
          adsEdges.delete(id);
        }
      }
      for (const customer of customers as DiscoveredAdsCustomer[]) {
        const id = resourceDocId(connectionId, customer.customerId);
        adsCustomers.set(id, {
          id,
          connectionId,
          operatorId,
          ...customer,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastSyncedAt: timestamp,
        });
      }
      for (const edge of edges as DiscoveredAdsEdge[]) {
        const id = hierarchyEdgeId(connectionId, edge.managerCustomerId, edge.clientCustomerId);
        adsEdges.set(id, {
          id,
          connectionId,
          operatorId,
          managerCustomerId: edge.managerCustomerId,
          clientCustomerId: edge.clientCustomerId,
          level: edge.level,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      const connection = connections.get(connectionId);
      if (connection) {
        connections.set(connectionId, {
          ...connection,
          lastSyncedAt: timestamp,
          updatedAt: timestamp,
        });
      }
    },

    async listAdsCustomers(operatorId, connectionId) {
      return [...adsCustomers.values()].filter(
        (item) =>
          item.operatorId === operatorId && (!connectionId || item.connectionId === connectionId),
      );
    },

    async findAdsCustomersByCustomerId(operatorId, customerId) {
      return [...adsCustomers.values()].filter(
        (item) => item.operatorId === operatorId && item.customerId === customerId,
      );
    },

    async listAdsHierarchyEdges(operatorId, connectionId) {
      return [...adsEdges.values()].filter(
        (item) =>
          item.operatorId === operatorId && (!connectionId || item.connectionId === connectionId),
      );
    },

    async replaceDv360Resources(operatorId, connectionId, partners, advertisers) {
      const timestamp = nowIso();
      for (const [id, partner] of dv360Partners) {
        if (partner.connectionId === connectionId) {
          dv360Partners.delete(id);
        }
      }
      for (const [id, advertiser] of dv360Advertisers) {
        if (advertiser.connectionId === connectionId) {
          dv360Advertisers.delete(id);
        }
      }
      for (const partner of partners as DiscoveredDv360Partner[]) {
        const id = resourceDocId(connectionId, partner.partnerId);
        dv360Partners.set(id, {
          id,
          connectionId,
          operatorId,
          ...partner,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastSyncedAt: timestamp,
        });
      }
      for (const advertiser of advertisers as DiscoveredDv360Advertiser[]) {
        const id = resourceDocId(connectionId, advertiser.advertiserId);
        dv360Advertisers.set(id, {
          id,
          connectionId,
          operatorId,
          ...advertiser,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastSyncedAt: timestamp,
        });
      }
      const connection = connections.get(connectionId);
      if (connection) {
        connections.set(connectionId, {
          ...connection,
          lastSyncedAt: timestamp,
          updatedAt: timestamp,
        });
      }
    },

    async listDv360Partners(operatorId, connectionId) {
      return [...dv360Partners.values()].filter(
        (item) =>
          item.operatorId === operatorId && (!connectionId || item.connectionId === connectionId),
      );
    },

    async findDv360PartnersByPartnerId(operatorId, partnerId) {
      return [...dv360Partners.values()].filter(
        (item) => item.operatorId === operatorId && item.partnerId === partnerId,
      );
    },

    async listDv360Advertisers(operatorId, connectionId) {
      return [...dv360Advertisers.values()].filter(
        (item) =>
          item.operatorId === operatorId && (!connectionId || item.connectionId === connectionId),
      );
    },

    async findDv360AdvertisersByAdvertiserId(operatorId, advertiserId) {
      return [...dv360Advertisers.values()].filter(
        (item) => item.operatorId === operatorId && item.advertiserId === advertiserId,
      );
    },

    async createTransaction(input) {
      const record: OAuthTransactionRecord = { ...input, consumedAt: null };
      transactions.set(record.nonce, record);
      return record;
    },

    async getTransaction(nonce) {
      return transactions.get(nonce);
    },

    async consumeTransaction(nonce) {
      const existing = transactions.get(nonce);
      if (!existing) {
        throw new AppError("OAuth state is invalid.", "unauthorized", 401);
      }
      if (existing.consumedAt) {
        throw new AppError("OAuth state has already been used.", "unauthorized", 401);
      }
      if (existing.exp < Date.now()) {
        throw new AppError(
          "OAuth state has expired. Start the Google authorization flow again.",
          "unauthorized",
          401,
        );
      }
      const consumed: OAuthTransactionRecord = { ...existing, consumedAt: nowIso() };
      transactions.set(nonce, consumed);
      return consumed;
    },

    async getSession(sessionId) {
      return sessions.get(sessionId);
    },

    async upsertSession(session) {
      sessions.set(session.sessionId, session);
      return session;
    },
  };
}
