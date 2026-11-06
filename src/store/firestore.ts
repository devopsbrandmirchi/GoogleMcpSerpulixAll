import { Firestore } from "@google-cloud/firestore";
import { randomUUID } from "node:crypto";
import { getConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import type {
  AdsCustomerRecord,
  AdsHierarchyEdgeRecord,
  AppStore,
  ConnectionStatus,
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

const OPERATORS = "operators";
const CONNECTIONS = "google_connections";
const UNIQUES = "connection_uniques";
const ACCOUNTS = "ga4_accounts";
const PROPERTIES = "ga4_properties";
const ADS_CUSTOMERS = "ads_customers";
const ADS_EDGES = "ads_hierarchy_edges";
const DV360_PARTNERS = "dv360_partners";
const DV360_ADVERTISERS = "dv360_advertisers";
const TRANSACTIONS = "oauth_transactions";
const SESSIONS = "sessions";

function nowIso(): string {
  return new Date().toISOString();
}

export function createFirestoreClient(): Firestore {
  const config = getConfig();
  return new Firestore({
    projectId: config.firestoreProjectId,
    databaseId: config.firestoreDatabaseId,
    ignoreUndefinedProperties: true,
  });
}

export function createFirestoreAppStore(dbFactory?: () => Firestore): AppStore {
  let client: Firestore | undefined;
  const db = () => {
    if (!client) {
      client = dbFactory ? dbFactory() : createFirestoreClient();
    }
    return client;
  };

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
      await db().collection(OPERATORS).doc(record.operatorId).set(record);
      return record;
    },

    async getOperator(operatorId) {
      const snapshot = await db().collection(OPERATORS).doc(operatorId).get();
      return snapshot.exists ? (snapshot.data() as OperatorRecord) : undefined;
    },

    async touchLastAccess(operatorId) {
      const ref = db().collection(OPERATORS).doc(operatorId);
      await db().runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) {
          return;
        }
        tx.update(ref, { lastAccessAt: nowIso() });
      });
    },

    async getConnection(connectionId) {
      const snapshot = await db().collection(CONNECTIONS).doc(connectionId).get();
      return snapshot.exists ? (snapshot.data() as GoogleConnectionRecord) : undefined;
    },

    async getConnectionForOperatorGoogle(operatorId, googleSubjectId) {
      const unique = await db()
        .collection(UNIQUES)
        .doc(connectionUniqueKey(operatorId, googleSubjectId))
        .get();
      const connectionId = unique.data()?.connectionId;
      if (typeof connectionId !== "string") {
        return undefined;
      }
      return this.getConnection(connectionId);
    },

    async listConnections(operatorId) {
      const snapshot = await db().collection(CONNECTIONS).where("operatorId", "==", operatorId).get();
      return snapshot.docs.map((doc) => doc.data() as GoogleConnectionRecord);
    },

    async listConnectionsByGoogleSubject(googleSubjectId) {
      const snapshot = await db()
        .collection(CONNECTIONS)
        .where("googleSubjectId", "==", googleSubjectId)
        .get();
      return snapshot.docs.map((doc) => doc.data() as GoogleConnectionRecord);
    },

    async upsertConnection(input: UpsertConnectionInput) {
      const uniqueKey = connectionUniqueKey(input.operatorId, input.googleSubjectId);
      const uniqueRef = db().collection(UNIQUES).doc(uniqueKey);

      return db().runTransaction(async (tx) => {
        const uniqueSnap = await tx.get(uniqueRef);
        const existingId =
          typeof uniqueSnap.data()?.connectionId === "string"
            ? String(uniqueSnap.data()?.connectionId)
            : input.connectionId;
        const connectionRef = existingId
          ? db().collection(CONNECTIONS).doc(existingId)
          : db().collection(CONNECTIONS).doc();
        const existingSnap = existingId ? await tx.get(connectionRef) : undefined;
        const existing = existingSnap?.exists
          ? (existingSnap.data() as GoogleConnectionRecord)
          : undefined;

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
          connectionId: existing?.connectionId ?? connectionRef.id,
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
        tx.set(connectionRef, record);
        tx.set(uniqueRef, {
          operatorId: input.operatorId,
          googleSubjectId: input.googleSubjectId,
          connectionId: record.connectionId,
        });
        return record;
      });
    },

    async markConnectionStatus(connectionId, status: ConnectionStatus, extra) {
      const ref = db().collection(CONNECTIONS).doc(connectionId);
      return db().runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) {
          throw new AppError(
            "The requested Google connection was not found.",
            "connection_not_found",
            404,
          );
        }
        const existing = snapshot.data() as GoogleConnectionRecord;
        const next: GoogleConnectionRecord = {
          ...existing,
          status,
          updatedAt: nowIso(),
          lastUsedAt: extra?.lastUsedAt ?? existing.lastUsedAt,
          lastSyncedAt: extra?.lastSyncedAt ?? existing.lastSyncedAt,
        };
        tx.set(ref, next);
        return next;
      });
    },

    async disconnectConnection(operatorId, connectionId) {
      const ref = db().collection(CONNECTIONS).doc(connectionId);
      return db().runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const existing = snapshot.exists ? (snapshot.data() as GoogleConnectionRecord) : undefined;
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
        tx.set(ref, next);
        return next;
      });
    },

    async replaceConnectionResources(operatorId, connectionId, discoveredAccounts, discoveredProperties) {
      const firestore = db();
      const timestamp = nowIso();
      const [existingAccounts, existingProperties] = await Promise.all([
        firestore.collection(ACCOUNTS).where("connectionId", "==", connectionId).get(),
        firestore.collection(PROPERTIES).where("connectionId", "==", connectionId).get(),
      ]);

      const previousProperties = new Map(existingProperties.docs.map((doc) => [doc.id, doc.data() as Ga4PropertyRecord]));
      const batch = firestore.batch();
      for (const doc of existingAccounts.docs) {
        batch.delete(doc.ref);
      }
      for (const doc of existingProperties.docs) {
        batch.delete(doc.ref);
      }
      for (const account of discoveredAccounts) {
        const id = resourceDocId(connectionId, account.ga4AccountId);
        const record: Ga4AccountRecord = {
          id,
          connectionId,
          operatorId,
          ga4AccountId: account.ga4AccountId,
          displayName: account.displayName,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastSyncedAt: timestamp,
        };
        batch.set(firestore.collection(ACCOUNTS).doc(id), record);
      }
      for (const property of discoveredProperties) {
        const id = resourceDocId(connectionId, property.propertyId);
        const record: Ga4PropertyRecord = {
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
        };
        batch.set(firestore.collection(PROPERTIES).doc(id), record);
      }
      batch.set(
        firestore.collection(CONNECTIONS).doc(connectionId),
        { lastSyncedAt: timestamp, updatedAt: timestamp },
        { merge: true },
      );
      await batch.commit();
    },

    async updatePropertyCreateTime(operatorId, connectionId, propertyId, propertyCreateTime) {
      const ref = db().collection(PROPERTIES).doc(resourceDocId(connectionId, propertyId));
      await db().runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const record = snapshot.data() as Ga4PropertyRecord | undefined;
        if (!record || record.operatorId !== operatorId || record.connectionId !== connectionId) {
          throw new AppError("Property not found for this operator and connection.", "property_not_found", 404);
        }
        tx.update(ref, { propertyCreateTime, updatedAt: nowIso() });
      });
    },

    async listAccounts(operatorId, connectionId) {
      let query = db().collection(ACCOUNTS).where("operatorId", "==", operatorId);
      if (connectionId) {
        query = query.where("connectionId", "==", connectionId);
      }
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => doc.data() as Ga4AccountRecord);
    },

    async listProperties(operatorId, connectionId) {
      let query = db().collection(PROPERTIES).where("operatorId", "==", operatorId);
      if (connectionId) {
        query = query.where("connectionId", "==", connectionId);
      }
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => doc.data() as Ga4PropertyRecord);
    },

    async findPropertiesByPropertyId(operatorId, propertyId) {
      const snapshot = await db()
        .collection(PROPERTIES)
        .where("operatorId", "==", operatorId)
        .where("propertyId", "==", propertyId)
        .get();
      return snapshot.docs.map((doc) => doc.data() as Ga4PropertyRecord);
    },

    async replaceAdsResources(operatorId, connectionId, customers, edges) {
      const firestore = db();
      const timestamp = nowIso();
      const [existingCustomers, existingEdges] = await Promise.all([
        firestore.collection(ADS_CUSTOMERS).where("connectionId", "==", connectionId).get(),
        firestore.collection(ADS_EDGES).where("connectionId", "==", connectionId).get(),
      ]);

      const batch = firestore.batch();
      for (const doc of existingCustomers.docs) {
        batch.delete(doc.ref);
      }
      for (const doc of existingEdges.docs) {
        batch.delete(doc.ref);
      }
      for (const customer of customers) {
        const id = resourceDocId(connectionId, customer.customerId);
        const record: AdsCustomerRecord = {
          id,
          connectionId,
          operatorId,
          ...customer,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastSyncedAt: timestamp,
        };
        batch.set(firestore.collection(ADS_CUSTOMERS).doc(id), record);
      }
      for (const edge of edges) {
        const id = hierarchyEdgeId(connectionId, edge.managerCustomerId, edge.clientCustomerId);
        const record: AdsHierarchyEdgeRecord = {
          id,
          connectionId,
          operatorId,
          managerCustomerId: edge.managerCustomerId,
          clientCustomerId: edge.clientCustomerId,
          level: edge.level,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        batch.set(firestore.collection(ADS_EDGES).doc(id), record);
      }
      batch.set(
        firestore.collection(CONNECTIONS).doc(connectionId),
        { lastSyncedAt: timestamp, updatedAt: timestamp },
        { merge: true },
      );
      await batch.commit();
    },

    async listAdsCustomers(operatorId, connectionId) {
      let query = db().collection(ADS_CUSTOMERS).where("operatorId", "==", operatorId);
      if (connectionId) {
        query = query.where("connectionId", "==", connectionId);
      }
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => doc.data() as AdsCustomerRecord);
    },

    async findAdsCustomersByCustomerId(operatorId, customerId) {
      const snapshot = await db()
        .collection(ADS_CUSTOMERS)
        .where("operatorId", "==", operatorId)
        .where("customerId", "==", customerId)
        .get();
      return snapshot.docs.map((doc) => doc.data() as AdsCustomerRecord);
    },

    async listAdsHierarchyEdges(operatorId, connectionId) {
      let query = db().collection(ADS_EDGES).where("operatorId", "==", operatorId);
      if (connectionId) {
        query = query.where("connectionId", "==", connectionId);
      }
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => doc.data() as AdsHierarchyEdgeRecord);
    },

    async replaceDv360Resources(operatorId, connectionId, partners, advertisers) {
      const firestore = db();
      const timestamp = nowIso();
      const [existingPartners, existingAdvertisers] = await Promise.all([
        firestore.collection(DV360_PARTNERS).where("connectionId", "==", connectionId).get(),
        firestore.collection(DV360_ADVERTISERS).where("connectionId", "==", connectionId).get(),
      ]);

      const batch = firestore.batch();
      for (const doc of existingPartners.docs) {
        batch.delete(doc.ref);
      }
      for (const doc of existingAdvertisers.docs) {
        batch.delete(doc.ref);
      }
      for (const partner of partners) {
        const id = resourceDocId(connectionId, partner.partnerId);
        const record: Dv360PartnerRecord = {
          id,
          connectionId,
          operatorId,
          ...partner,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastSyncedAt: timestamp,
        };
        batch.set(firestore.collection(DV360_PARTNERS).doc(id), record);
      }
      for (const advertiser of advertisers) {
        const id = resourceDocId(connectionId, advertiser.advertiserId);
        const record: Dv360AdvertiserRecord = {
          id,
          connectionId,
          operatorId,
          ...advertiser,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastSyncedAt: timestamp,
        };
        batch.set(firestore.collection(DV360_ADVERTISERS).doc(id), record);
      }
      batch.set(
        firestore.collection(CONNECTIONS).doc(connectionId),
        { lastSyncedAt: timestamp, updatedAt: timestamp },
        { merge: true },
      );
      await batch.commit();
    },

    async listDv360Partners(operatorId, connectionId) {
      let query = db().collection(DV360_PARTNERS).where("operatorId", "==", operatorId);
      if (connectionId) {
        query = query.where("connectionId", "==", connectionId);
      }
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => doc.data() as Dv360PartnerRecord);
    },

    async findDv360PartnersByPartnerId(operatorId, partnerId) {
      const snapshot = await db()
        .collection(DV360_PARTNERS)
        .where("operatorId", "==", operatorId)
        .where("partnerId", "==", partnerId)
        .get();
      return snapshot.docs.map((doc) => doc.data() as Dv360PartnerRecord);
    },

    async listDv360Advertisers(operatorId, connectionId) {
      let query = db().collection(DV360_ADVERTISERS).where("operatorId", "==", operatorId);
      if (connectionId) {
        query = query.where("connectionId", "==", connectionId);
      }
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => doc.data() as Dv360AdvertiserRecord);
    },

    async findDv360AdvertisersByAdvertiserId(operatorId, advertiserId) {
      const snapshot = await db()
        .collection(DV360_ADVERTISERS)
        .where("operatorId", "==", operatorId)
        .where("advertiserId", "==", advertiserId)
        .get();
      return snapshot.docs.map((doc) => doc.data() as Dv360AdvertiserRecord);
    },

    async createTransaction(input) {
      const record: OAuthTransactionRecord = { ...input, consumedAt: null };
      await db().collection(TRANSACTIONS).doc(record.nonce).set(record);
      return record;
    },

    async getTransaction(nonce) {
      const snapshot = await db().collection(TRANSACTIONS).doc(nonce).get();
      return snapshot.exists ? (snapshot.data() as OAuthTransactionRecord) : undefined;
    },

    async consumeTransaction(nonce) {
      const ref = db().collection(TRANSACTIONS).doc(nonce);
      return db().runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) {
          throw new AppError("OAuth state is invalid.", "unauthorized", 401);
        }
        const existing = snapshot.data() as OAuthTransactionRecord;
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
        tx.set(ref, consumed);
        return consumed;
      });
    },

    async getSession(sessionId) {
      const snapshot = await db().collection(SESSIONS).doc(sessionId).get();
      return snapshot.exists ? (snapshot.data() as SessionRecord) : undefined;
    },

    async upsertSession(session) {
      await db().collection(SESSIONS).doc(session.sessionId).set(session);
      return session;
    },
  };
}
