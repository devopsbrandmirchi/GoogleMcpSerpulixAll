# Deployment

Target: Google Cloud Run + named Firestore `google-mcp-serpulix-all`.

## Isolation

| Product | Firestore database |
|---------|--------------------|
| V1 | `(default)` — forbidden |
| V3 | `ga4-mcp-v3` — forbidden |
| This app | `google-mcp-serpulix-all` |

Create a **new** Google OAuth web client. Do not reuse V3 secrets.

## Steps

1. `.\scripts\cloud-run-setup.ps1 -ProjectId YOUR_PROJECT` — enables APIs (including Display & Video 360), creates Artifact Registry and named Firestore DB
2. Build and deploy with `.\scripts\cloud-run-deploy.ps1`
3. Set env with `.\scripts\cloud-run-set-env.ps1`
4. Add `{APP_BASE_URL}/oauth/google/callback` to the Google OAuth client
5. In Claude.ai, add a Custom Connector pointing at `{APP_BASE_URL}/mcp`

Cloud Run must allow unauthenticated ingress. MCP auth is Bearer JWT, not Cloud IAM.

Deploy indexes from `firestore.indexes.json` to database `google-mcp-serpulix-all`.
