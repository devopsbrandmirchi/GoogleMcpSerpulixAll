import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { AppError, mapGoogleError } from "@/lib/errors";
import {
  DV360_SCOPE,
  GA4_READONLY_SCOPE,
  GOOGLE_ADS_SCOPE,
  GOOGLE_OPENID_SCOPES,
  getConfig,
} from "@/lib/config";
import { logger } from "@/lib/logger";
import { decryptRefreshToken, encryptRefreshToken } from "@/lib/crypto";
import { getAppStore } from "@/store/app-store";
import type { GoogleConnectionRecord } from "@/store/types";

const STATE_TTL_MS = 15 * 60 * 1000;

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export interface SignedOAuthState {
  nonce: string;
  operation: string;
  exp: number;
}

export interface GoogleIdentity {
  googleSubjectId: string;
  email: string | null;
  displayName: string | null;
  refreshToken: string | null;
  scopes: string[];
}

const accessTokenCache = new Map<string, { token: string; exp: number; client: OAuth2Client }>();
const refreshLocks = new Map<string, Promise<OAuth2Client>>();

export function createOAuthClient(): OAuth2Client {
  const config = getConfig();
  return new OAuth2Client({
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: config.googleRedirectUri,
  });
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function signOAuthState(
  state: SignedOAuthState,
  secret = getConfig().oauthStateSecret,
): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyOAuthState(
  value: string,
  secret = getConfig().oauthStateSecret,
): SignedOAuthState {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) {
    throw new AppError("OAuth state is invalid.", "unauthorized", 401);
  }

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new AppError("OAuth state is invalid.", "unauthorized", 401);
  }

  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SignedOAuthState;
  if (!parsed.nonce || typeof parsed.exp !== "number" || parsed.exp < Date.now()) {
    throw new AppError(
      "OAuth state has expired. Start the Google authorization flow again.",
      "unauthorized",
      401,
    );
  }
  return parsed;
}

export function createSignedOAuthState(operation: string): string {
  return signOAuthState({
    nonce: randomBytes(16).toString("hex"),
    operation,
    exp: Date.now() + STATE_TTL_MS,
  });
}

export function buildGoogleAuthUrl(params: {
  state: string;
  codeChallenge: string;
}): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    scope: [...GOOGLE_OPENID_SCOPES],
    include_granted_scopes: false,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
}

export async function exchangeAuthorizationCode(params: {
  code: string;
  codeVerifier: string;
}): Promise<GoogleIdentity> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken({
    code: params.code,
    codeVerifier: params.codeVerifier,
  });

  if (!tokens.id_token) {
    throw new AppError(
      "Google did not return an ID token. OpenID is required to identify the Google account.",
      "unauthorized",
      400,
    );
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: getConfig().googleClientId,
  });
  const payload = ticket.getPayload();
  const googleSubjectId = payload?.sub?.trim();
  if (!googleSubjectId) {
    throw new AppError("Google identity is missing a subject identifier.", "unauthorized", 400);
  }

  return {
    googleSubjectId,
    email: payload?.email ?? null,
    displayName: payload?.name ?? null,
    refreshToken: tokens.refresh_token ?? null,
    scopes: parseGrantedScopes(tokens.scope),
  };
}

export async function assertConnectionOwned(
  operatorId: string,
  connectionId: string,
): Promise<GoogleConnectionRecord> {
  const connection = await getAppStore().getConnection(connectionId);
  if (!connection || connection.operatorId !== operatorId) {
    throw new AppError(
      "The requested Google connection was not found.",
      "connection_not_found",
      404,
    );
  }
  return connection;
}

export function parseGrantedScopes(scope?: string | null): string[] {
  const granted = (scope ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return granted.length > 0 ? [...new Set(granted)] : [...GOOGLE_OPENID_SCOPES];
}

export function connectionHasScope(connection: GoogleConnectionRecord, scope: string): boolean {
  return connection.scopes.includes(scope);
}

export function connectionProducts(
  connection: GoogleConnectionRecord,
): Array<"GA4" | "Google Ads" | "DV360"> {
  const products: Array<"GA4" | "Google Ads" | "DV360"> = [];
  if (connectionHasScope(connection, GA4_READONLY_SCOPE)) {
    products.push("GA4");
  }
  if (connectionHasScope(connection, GOOGLE_ADS_SCOPE)) {
    products.push("Google Ads");
  }
  if (connectionHasScope(connection, DV360_SCOPE)) {
    products.push("DV360");
  }
  return products;
}

export function publicConnectionView(connection: GoogleConnectionRecord) {
  return {
    connectionId: connection.connectionId,
    googleEmail: connection.googleEmail,
    googleDisplayName: connection.googleDisplayName,
    status: connection.status,
    products: connectionProducts(connection),
    lastUsedAt: connection.lastUsedAt,
    lastSyncedAt: connection.lastSyncedAt,
  };
}

async function persistRotatedRefreshToken(
  operatorId: string,
  connection: GoogleConnectionRecord,
  refreshToken: string,
): Promise<void> {
  await getAppStore().upsertConnection({
    operatorId,
    googleSubjectId: connection.googleSubjectId,
    googleEmail: connection.googleEmail,
    googleDisplayName: connection.googleDisplayName,
    encryptedRefreshToken: encryptRefreshToken(refreshToken),
    scopes: connection.scopes,
    connectionId: connection.connectionId,
  });
}

export async function getAuthorizedClientForConnection(
  operatorId: string,
  connectionId: string,
): Promise<OAuth2Client> {
  const existingLock = refreshLocks.get(connectionId);
  if (existingLock) {
    return existingLock;
  }

  const work = (async () => {
    const cached = accessTokenCache.get(connectionId);
    if (cached && cached.exp > Date.now() + 60_000) {
      return cached.client;
    }

    const connection = await assertConnectionOwned(operatorId, connectionId);
    if (connection.status === "disconnected") {
      throw new AppError(
        "This Google connection has been disconnected.",
        "not_connected",
        401,
      );
    }
    if (connection.status === "reauthorization_required" || connection.status === "revoked") {
      throw new AppError(
        `The Google connection for ${connection.googleEmail ?? "this account"} requires reauthorization.`,
        "reauthorization_required",
        401,
      );
    }
    if (!connection.refreshTokenEncrypted) {
      throw new AppError(
        "No Google Account is connected to this operator. Please connect a Google Account first.",
        "no_google_connections",
        401,
      );
    }

    let refreshToken: string;
    try {
      refreshToken = decryptRefreshToken(connection.refreshTokenEncrypted);
    } catch {
      throw new AppError(
        "Stored Google credentials could not be decrypted. Reconnect this Google account from Claude.",
        "not_connected",
        401,
      );
    }

    const client = createOAuthClient();
    client.setCredentials({ refresh_token: refreshToken });

    try {
      const accessToken = await client.getAccessToken();
      if (!accessToken.token) {
        await getAppStore().markConnectionStatus(connectionId, "reauthorization_required");
        throw new AppError(
          `The Google connection for ${connection.googleEmail ?? "this account"} requires reauthorization.`,
          "reauthorization_required",
          401,
        );
      }

      const rotated = client.credentials.refresh_token;
      if (rotated && rotated !== refreshToken) {
        await persistRotatedRefreshToken(operatorId, connection, rotated);
        logger.info("Rotated Google refresh token", { operatorId, connectionId });
      }

      const expiry = client.credentials.expiry_date ?? Date.now() + 50 * 60 * 1000;
      accessTokenCache.set(connectionId, {
        token: accessToken.token,
        exp: expiry,
        client,
      });
      await getAppStore().markConnectionStatus(connectionId, "active", {
        lastUsedAt: new Date().toISOString(),
      });
      return client;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      const mapped = mapGoogleError(error, "oauth");
      if (mapped.code === "reauthorization_required" || mapped.code === "revoked") {
        await getAppStore().markConnectionStatus(connectionId, "reauthorization_required");
        throw new AppError(
          `The Google connection for ${connection.googleEmail ?? "this account"} requires reauthorization.`,
          "reauthorization_required",
          401,
        );
      }
      throw mapped;
    }
  })();

  refreshLocks.set(connectionId, work);
  try {
    return await work;
  } finally {
    refreshLocks.delete(connectionId);
  }
}

export function clearAccessTokenCache(connectionId?: string): void {
  if (connectionId) {
    accessTokenCache.delete(connectionId);
    return;
  }
  accessTokenCache.clear();
}

export function connectionScopes(): string[] {
  return [...GOOGLE_OPENID_SCOPES];
}

export { DV360_SCOPE, GA4_READONLY_SCOPE, GOOGLE_ADS_SCOPE };
