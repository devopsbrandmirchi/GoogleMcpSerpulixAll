# Identity model

True Model B is preserved from GA4 MCP V3.

## Two identities

| Identity | Field | Source |
|----------|-------|--------|
| MCP operator | `operatorId` | MCP JWT `sub` |
| Google account | `googleSubjectId` | Google OpenID `sub` on `google_connections` |

These are never interchangeable.

## Multi-connection

One operator can connect Google A, B, and C independently.

The same Google identity connected by Operator A and Operator B produces two connection documents. They do not share refresh tokens.

Uniqueness key: `connection_uniques/{operatorId}_{googleSubjectId}`.

Email is display metadata only.

## Resume vs start new

During first MCP authorize, if the signed-in Google subject already has connections on other operators, the user chooses **Resume** or **Start new**. Connections are never merged.
