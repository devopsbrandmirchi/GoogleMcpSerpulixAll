# Security

- Operator isolation: every resource lookup is filtered by JWT `sub` / `operatorId`
- Encrypted refresh tokens at rest (`TOKEN_ENCRYPTION_KEY`, purpose `refresh-token`)
- OAuth state HMAC + PKCE on both MCP and Google legs
- Browser cannot supply `operatorId` on the Google callback
- No refresh tokens, developer token, or cookies in logs
- Safe MCP errors: `{ error, message }` only
- DV360 and Google Ads query tools are read-only. Opt-in Google Ads write tools can create and edit resources but never delete them: removes are limited to links and targeting criteria, `REMOVED` status is rejected, new campaigns are PAUSED, and every write needs the customer allowlist, budget caps, a validation default and a confirmation flag. Image downloads use https only, follow at most 3 redirects, and check every hop's DNS results so private, loopback, link-local, CGNAT, metadata and IPv6 ULA addresses are refused; bodies are limited to 20 MB and decoded by sharp before upload. The image upload page at `/ads/upload` is authorized by a signed `ads_upload` token (30-minute lifetime) that is bound to one operator, session, Google Ads customer and connection; it accepts at most 5 images of 10 MB each and runs the same write checks (writes enabled, customer allowlist, client account) as other writes. See [Google Ads writes](campaign-creation.md).
- Named Firestore database isolation from V1/V3

Required secrets (never commit):

- `MCP_TOKEN_SECRET`
- `OAUTH_STATE_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
