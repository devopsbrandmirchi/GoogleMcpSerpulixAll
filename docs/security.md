# Security

- Operator isolation: every resource lookup is filtered by JWT `sub` / `operatorId`
- Encrypted refresh tokens at rest (`TOKEN_ENCRYPTION_KEY`, purpose `refresh-token`)
- OAuth state HMAC + PKCE on both MCP and Google legs
- Browser cannot supply `operatorId` on the Google callback
- No refresh tokens, developer token, or cookies in logs
- Safe MCP errors: `{ error, message }` only
- Google Ads and DV360 are read-only
- Named Firestore database isolation from V1/V3

Required secrets (never commit):

- `MCP_TOKEN_SECRET`
- `OAUTH_STATE_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
