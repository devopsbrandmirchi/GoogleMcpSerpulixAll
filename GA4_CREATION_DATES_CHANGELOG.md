# GA4 original property creation dates

`ga4_list_properties` now returns `propertyCreateTime` (ISO 8601 UTC, or null if unknown). This is distinct from the connector's own `createdAt` field.

To populate existing properties, invoke the MCP tool with:

```json
{"refreshCreationDates": true}
```

Optionally pass `connectionId` to restrict the refresh to one Google connection. The tool returns `refresh.updated`, `refresh.unavailable`, and `refresh.failed` counters. Failed individual lookups do not delete property records or overwrite a previously known timestamp. Re-run a refresh later if some lookups fail. A normal call without `refreshCreationDates` reads cached values and makes no extra Google API calls.

Newly discovered properties attempt to retrieve `createTime` from the Analytics Admin API. If the API lookup fails, the property is still discovered. Existing `propertyCreateTime` and connector `createdAt` values survive rediscovery for the same property.

## Local validation

Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` on a machine with working npm registry access. No live Google OAuth credentials are included or needed for unit tests. For an integration check, call `ga4_list_properties` with `refreshCreationDates: true` against an existing authorized connection, then call it again without refresh.

## Notes

A refresh makes one Google Admin API getProperty request per stored GA4 property. Large accounts may encounter rate limits. The refresh is requested explicitly, not on every list call. It does not create new properties; the connector's existing discovery process remains responsible for inventory changes.
