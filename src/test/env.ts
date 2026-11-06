export function setRequiredEnv(overrides: Record<string, string | undefined> = {}): void {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/oauth/google/callback";
  process.env.MCP_TOKEN_SECRET = "test-mcp-token-secret";
  process.env.OAUTH_STATE_SECRET = "test-oauth-state-secret";
  process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  process.env.FIRESTORE_PROJECT_ID = "test-firestore-project";
  process.env.FIRESTORE_DATABASE_ID = "google-mcp-serpulix-all";
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-ads-developer-token";
  delete process.env.GOOGLE_REFRESH_TOKEN;
  delete process.env.MCP_AUTH_TOKEN;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.VERCEL;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
