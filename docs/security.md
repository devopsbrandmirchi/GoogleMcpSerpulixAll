# Security

- Operator isolation: every resource lookup is filtered by JWT `sub` / `operatorId`
- Encrypted refresh tokens at rest (`TOKEN_ENCRYPTION_KEY`, purpose `refresh-token`)
- OAuth state HMAC + PKCE on both MCP and Google legs
- Browser cannot supply `operatorId` on the Google callback
- No refresh tokens, developer token, or cookies in logs
- Safe MCP errors: `{ error, message }` only
- DV360 and Google Ads query tools are read-only. Opt-in Google Ads write tools can create and edit resources but never delete them: removes are limited to links and targeting criteria, `REMOVED` status is rejected, new campaigns are PAUSED, and every write needs the customer allowlist, budget caps, a validation default and a confirmation flag. Image assets are downloaded only from public https hosts, without redirects, up to 5 MB. See [Google Ads writes](campaign-creation.md).
- Named Firestore database isolation from V1/V3

Required secrets (never commit):

- `MCP_TOKEN_SECRET`
- `OAUTH_STATE_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
