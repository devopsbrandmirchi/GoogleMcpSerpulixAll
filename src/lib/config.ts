export const APP_VERSION = "1.0.0";

export const GA4_READONLY_SCOPE =
  "https://www.googleapis.com/auth/analytics.readonly";

export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

export const DV360_SCOPE = "https://www.googleapis.com/auth/display-video";

export function isDv360Enabled(): boolean {
  return process.env.DV360_ENABLED === "true";
}

export function googleOAuthScopes(): string[] {
  return [
    "openid",
    "email",
    GA4_READONLY_SCOPE,
    GOOGLE_ADS_SCOPE,
    ...(isDv360Enabled() ? [DV360_SCOPE] : []),
  ];
}

export const DEFAULT_FIRESTORE_DATABASE_ID = "google-mcp-serpulix-all";

export const FORBIDDEN_FIRESTORE_DATABASE_IDS = new Set([
  "(default)",
  "default",
  "ga4-mcp-v3",
  "ga4-mcp-v2",
  "ga4-mcp-v1",
]);

export interface AppConfig {
  appBaseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  mcpTokenSecret: string;
  oauthStateSecret: string;
  tokenEncryptionKey: string;
  firestoreProjectId: string | undefined;
  firestoreDatabaseId: string;
  googleAdsDeveloperToken: string;
  mcpOAuthClientId: string | undefined;
  mcpOAuthClientSecret: string | undefined;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function resolveFirestoreDatabaseId(raw?: string): string {
  const value = (raw ?? "").trim();
  if (!value) {
    throw new Error("Missing required environment variable: FIRESTORE_DATABASE_ID");
  }
  const normalized = value.toLowerCase();
  if (FORBIDDEN_FIRESTORE_DATABASE_IDS.has(value) || FORBIDDEN_FIRESTORE_DATABASE_IDS.has(normalized)) {
    throw new Error(
      `FIRESTORE_DATABASE_ID must be the named database "${DEFAULT_FIRESTORE_DATABASE_ID}". ` +
        `Do not use "(default)", "ga4-mcp-v3", or any other product database.`,
    );
  }
  if (value !== DEFAULT_FIRESTORE_DATABASE_ID) {
    throw new Error(
      `FIRESTORE_DATABASE_ID must be "${DEFAULT_FIRESTORE_DATABASE_ID}" so this app does not conflict with other Firestore databases.`,
    );
  }
  return value;
}

export function getConfig(): AppConfig {
  const appBaseUrl = stripTrailingSlash(required("APP_BASE_URL"));
  const googleRedirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() || `${appBaseUrl}/oauth/google/callback`;

  return {
    appBaseUrl,
    googleClientId: required("GOOGLE_CLIENT_ID"),
    googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
    googleRedirectUri,
    mcpTokenSecret: required("MCP_TOKEN_SECRET"),
    oauthStateSecret: required("OAUTH_STATE_SECRET"),
    tokenEncryptionKey: required("TOKEN_ENCRYPTION_KEY"),
    firestoreProjectId: process.env.FIRESTORE_PROJECT_ID?.trim() || undefined,
    firestoreDatabaseId: resolveFirestoreDatabaseId(process.env.FIRESTORE_DATABASE_ID),
    googleAdsDeveloperToken: required("GOOGLE_ADS_DEVELOPER_TOKEN"),
    mcpOAuthClientId: process.env.MCP_OAUTH_CLIENT_ID?.trim() || undefined,
    mcpOAuthClientSecret: process.env.MCP_OAUTH_CLIENT_SECRET?.trim() || undefined,
  };
}
