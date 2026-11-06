import type { PendingMcpAuthorize } from "@/mcp/oauth/pending";

export const LEGACY_SESSION_ID = "legacy";

export type ConnectionStatus =
  | "active"
  | "reauthorization_required"
  | "revoked"
  | "disconnected"
  | "error";

export type OAuthOperation =
  | "bootstrap_operator"
  | "add_connection"
  | "reconnect"
  | "resume_choice";

export type ProductId = "ga4" | "google_ads" | "dv360";

export interface OperatorRecord {
  operatorId: string;
  primaryEmail: string | null;
  createdAt: string;
  updatedAt: string;
  lastAccessAt: string;
}

export interface GoogleConnectionRecord {
  connectionId: string;
  operatorId: string;
  googleSubjectId: string;
  googleEmail: string | null;
  googleDisplayName: string | null;
  refreshTokenEncrypted: string | null;
  scopes: string[];
  status: ConnectionStatus;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  lastSyncedAt: string | null;
}

export interface Ga4AccountRecord {
  id: string;
  connectionId: string;
  operatorId: string;
  ga4AccountId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string;
}

export interface Ga4PropertyRecord {
  id: string;
  connectionId: string;
  operatorId: string;
  ga4AccountId: string;
  propertyId: string;
  displayName: string;
  propertyType: string;
  propertyCreateTime?: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string;
}

export interface AdsCustomerRecord {
  id: string;
  connectionId: string;
  operatorId: string;
  customerId: string;
  descriptiveName: string;
  currencyCode: string | null;
  timeZone: string | null;
  status: string;
  manager: boolean;
  directlyAccessible: boolean;
  loginCustomerId: string | null;
  accessibleManagerIds: string[];
  level: number;
  parentCustomerId: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string;
}

export interface AdsHierarchyEdgeRecord {
  id: string;
  connectionId: string;
  operatorId: string;
  managerCustomerId: string;
  clientCustomerId: string;
  level: number;
  createdAt: string;
  updatedAt: string;
}

export interface Dv360PartnerRecord {
  id: string;
  connectionId: string;
  operatorId: string;
  partnerId: string;
  displayName: string;
  entityStatus: string | null;
  currencyCode: string | null;
  timeZone: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string;
}

export interface Dv360AdvertiserRecord {
  id: string;
  connectionId: string;
  operatorId: string;
  partnerId: string;
  advertiserId: string;
  displayName: string;
  entityStatus: string | null;
  currencyCode: string | null;
  timeZone: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string;
}

export interface ResumeCandidate {
  operatorId: string;
  primaryEmail: string | null;
  googleEmail: string | null;
  connectionCount: number;
  createdAt: string;
}

export interface OAuthTransactionRecord {
  nonce: string;
  operatorId: string | null;
  operation: OAuthOperation;
  connectionId: string | null;
  mcpPending: PendingMcpAuthorize | null;
  codeVerifier: string | null;
  googleState: string | null;
  exp: number;
  consumedAt: string | null;
  resumeCandidates?: ResumeCandidate[];
  pendingGoogleSubjectId?: string;
  pendingGoogleEmail?: string | null;
  pendingGoogleDisplayName?: string | null;
  pendingRefreshTokenEncrypted?: string | null;
  pendingGoogleScopes?: string[];
}

export interface SessionRecord {
  sessionId: string;
  operatorId: string;
  activeConnectionId: string | null;
  activePropertyId: string | null;
  activePropertyName: string | null;
  activePropertyAccount: string | null;
  activeAdsCustomerId: string | null;
  activeAdsConnectionId: string | null;
  updatedAt: string;
}

export interface UpsertConnectionInput {
  operatorId: string;
  googleSubjectId: string;
  googleEmail?: string | null;
  googleDisplayName?: string | null;
  encryptedRefreshToken?: string;
  scopes?: string[];
  connectionId?: string;
}

export interface DiscoveredAccount {
  ga4AccountId: string;
  displayName: string;
}

export interface DiscoveredProperty {
  ga4AccountId: string;
  propertyId: string;
  displayName: string;
  propertyType: string;
  propertyCreateTime?: string | null;
}

export interface DiscoveredAdsCustomer {
  customerId: string;
  descriptiveName: string;
  currencyCode: string | null;
  timeZone: string | null;
  status: string;
  manager: boolean;
  directlyAccessible: boolean;
  loginCustomerId: string | null;
  accessibleManagerIds: string[];
  level: number;
  parentCustomerId: string | null;
}

export interface DiscoveredAdsEdge {
  managerCustomerId: string;
  clientCustomerId: string;
  level: number;
}

export interface DiscoveredDv360Partner {
  partnerId: string;
  displayName: string;
  entityStatus: string | null;
  currencyCode: string | null;
  timeZone: string | null;
}

export interface DiscoveredDv360Advertiser {
  partnerId: string;
  advertiserId: string;
  displayName: string;
  entityStatus: string | null;
  currencyCode: string | null;
  timeZone: string | null;
}

export interface AppStore {
  createOperator(primaryEmail?: string | null): Promise<OperatorRecord>;
  getOperator(operatorId: string): Promise<OperatorRecord | undefined>;
  touchLastAccess(operatorId: string): Promise<void>;

  getConnection(connectionId: string): Promise<GoogleConnectionRecord | undefined>;
  getConnectionForOperatorGoogle(
    operatorId: string,
    googleSubjectId: string,
  ): Promise<GoogleConnectionRecord | undefined>;
  listConnections(operatorId: string): Promise<GoogleConnectionRecord[]>;
  listConnectionsByGoogleSubject(googleSubjectId: string): Promise<GoogleConnectionRecord[]>;
  upsertConnection(input: UpsertConnectionInput): Promise<GoogleConnectionRecord>;
  markConnectionStatus(
    connectionId: string,
    status: ConnectionStatus,
    extra?: { lastUsedAt?: string; lastSyncedAt?: string },
  ): Promise<GoogleConnectionRecord>;
  disconnectConnection(operatorId: string, connectionId: string): Promise<GoogleConnectionRecord>;

  replaceConnectionResources(
    operatorId: string,
    connectionId: string,
    accounts: DiscoveredAccount[],
    properties: DiscoveredProperty[],
  ): Promise<void>;
  listAccounts(operatorId: string, connectionId?: string): Promise<Ga4AccountRecord[]>;
  listProperties(operatorId: string, connectionId?: string): Promise<Ga4PropertyRecord[]>;
  updatePropertyCreateTime(operatorId: string, connectionId: string, propertyId: string, propertyCreateTime: string): Promise<void>;
  findPropertiesByPropertyId(
    operatorId: string,
    propertyId: string,
  ): Promise<Ga4PropertyRecord[]>;

  replaceAdsResources(
    operatorId: string,
    connectionId: string,
    customers: DiscoveredAdsCustomer[],
    edges: DiscoveredAdsEdge[],
  ): Promise<void>;
  listAdsCustomers(operatorId: string, connectionId?: string): Promise<AdsCustomerRecord[]>;
  findAdsCustomersByCustomerId(
    operatorId: string,
    customerId: string,
  ): Promise<AdsCustomerRecord[]>;
  listAdsHierarchyEdges(operatorId: string, connectionId?: string): Promise<AdsHierarchyEdgeRecord[]>;

  replaceDv360Resources(
    operatorId: string,
    connectionId: string,
    partners: DiscoveredDv360Partner[],
    advertisers: DiscoveredDv360Advertiser[],
  ): Promise<void>;
  listDv360Partners(operatorId: string, connectionId?: string): Promise<Dv360PartnerRecord[]>;
  findDv360PartnersByPartnerId(
    operatorId: string,
    partnerId: string,
  ): Promise<Dv360PartnerRecord[]>;
  listDv360Advertisers(operatorId: string, connectionId?: string): Promise<Dv360AdvertiserRecord[]>;
  findDv360AdvertisersByAdvertiserId(
    operatorId: string,
    advertiserId: string,
  ): Promise<Dv360AdvertiserRecord[]>;

  createTransaction(
    input: Omit<OAuthTransactionRecord, "consumedAt">,
  ): Promise<OAuthTransactionRecord>;
  getTransaction(nonce: string): Promise<OAuthTransactionRecord | undefined>;
  consumeTransaction(nonce: string): Promise<OAuthTransactionRecord>;

  getSession(sessionId: string): Promise<SessionRecord | undefined>;
  upsertSession(session: SessionRecord): Promise<SessionRecord>;
}

export function normalizeSessionId(sessionId?: string | null): string {
  const trimmed = sessionId?.trim();
  return trimmed || LEGACY_SESSION_ID;
}

export function resourceDocId(connectionId: string, resourceId: string): string {
  return `${connectionId}_${resourceId.replaceAll("/", "_")}`;
}

export function connectionUniqueKey(operatorId: string, googleSubjectId: string): string {
  return `${operatorId}_${googleSubjectId}`;
}

export function hierarchyEdgeId(
  connectionId: string,
  managerCustomerId: string,
  clientCustomerId: string,
): string {
  return `${connectionId}_${managerCustomerId}_${clientCustomerId}`;
}
