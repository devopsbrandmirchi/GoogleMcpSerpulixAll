# Google connections

Shared OAuth credential layer. Product adapters do not implement their own login systems.

## Collection

`google_connections/{connectionId}` in named database `google-mcp-serpulix-all`:

- `operatorId`
- `googleSubjectId`
- `googleEmail`, `googleDisplayName`
- `refreshTokenEncrypted` (AES-256-GCM)
- `scopes[]`
- `status`: `active`, `reauthorization_required`, `revoked`, `disconnected`, `error`

Refresh tokens are never returned by MCP tools or API responses.

## Product data

Kept separate:

- `ga4_accounts`, `ga4_properties`
- `ads_customers`, `ads_hierarchy_edges`
- `dv360_partners`, `dv360_advertisers`

Routing is always:

```text
operator + resource
  -> product collection scoped by operatorId
  -> connectionId
  -> encrypted refresh token
  -> Google API
```

Never "most recently connected Google account."
