# Architecture

`google-mcp-serpulix-all` is a Next.js 15 Cloud Run MCP server.

```mermaid
flowchart TB
  Claude["Claude.ai Custom Connector"]
  McpAuth["MCP OAuth 2.1 DCR CIMD PKCE"]
  Operator["operators operatorId = JWT sub"]
  Resolver["ConnectionResolver"]
  Conn["google_connections"]
  Ga4["products/ga4"]
  Ads["products/google-ads"]
  Dv360["products/dv360"]
  Ga4Api["GA4 Admin and Data APIs"]
  AdsApi["Google Ads REST v25"]
  DvApi["DV360 REST v4"]

  Claude --> McpAuth
  McpAuth --> Operator
  Claude -->|"Bearer JWT"| Operator
  Operator --> Resolver
  Resolver --> Conn
  Resolver --> Ga4
  Resolver --> Ads
  Resolver --> Dv360
  Ga4 --> Ga4Api
  Ads --> AdsApi
  Dv360 --> DvApi
```

## Layers

- `src/mcp` — Claude Custom Connector surface, MCP OAuth, tool registration
- `src/providers/google` — shared Google OAuth, token refresh, connection ownership
- `src/core/resolver.ts` — product-aware resource resolution
- `src/products/ga4` — GA4 discovery, routing, Data/Admin API
- `src/products/google-ads` — Ads REST client, hierarchy, routing, GAQL
- `src/products/dv360` — Display & Video 360 REST v4 client, partner/advertiser discovery, routing
- `src/store` — Firestore + in-memory `AppStore`

DV360 reporting (Bid Manager / spend) is not implemented. Discovery tools reuse operator identity, Google connections, OAuth, encryption, resolver, MCP auth, and logging.
