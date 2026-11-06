# GA4

GA4 behavior is adapted from V3 into `src/products/ga4`.

## Tools

`ga4_list_accounts`, `ga4_list_properties`, `ga4_get_active_property`, `ga4_set_active_property`, `ga4_get_metadata`, `ga4_run_report`, `ga4_run_realtime_report`.

## Routing

`propertyId` is looked up in `ga4_properties` for the current operator. If the same property exists on two connections, the tool requires `connectionId`.

Session active property is stored on `sessions/{sid}` and is not "last used connection."
