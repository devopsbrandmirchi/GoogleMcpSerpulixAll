# Google Ads

Official REST API version: **v25** (`src/products/google-ads/api/version.ts`).

There is no official Node.js client. This app uses `google-auth-library` plus `fetch`.

## Credentials

Every Ads call sends:

- `Authorization: Bearer` from the resolved Google connection
- `developer-token` from `GOOGLE_ADS_DEVELOPER_TOKEN` (application secret)
- `login-customer-id` only when the customer is reached through a manager

The developer token is never logged or returned to Claude.

A Google connection can show product `Google Ads` and still list zero accounts if discovery fails. Cloud logs currently show Ads `403` on `customers:listAccessibleCustomers`. That is an API/developer-token permission problem, not an empty OAuth grant. A test developer token can only access test Ads accounts; production MCC accounts require at least Basic access and a Cloud project that is allowed to use that token.

## Discovery

1. `customers:listAccessibleCustomers`
2. `CustomerClient` GAQL recursion from each accessible manager
3. Persist `ads_customers` and `ads_hierarchy_edges` scoped to `(operatorId, connectionId)`

## login-customer-id

- Directly accessible customer: header omitted
- Client under an MCC: header set to the authorized manager
- Same customer in multiple hierarchies: shortest path, then lowest manager ID

Customer IDs are normalized by stripping hyphens (`123-456-7890` → `1234567890`).

## Tools

`ads_list_accessible_accounts`, `ads_get_account_hierarchy`, `ads_get_account`, `ads_run_query`, `ads_campaigns`, `ads_ad_groups`, `ads_ads`, `ads_campaign_performance`.

`ads_run_query` accepts SELECT GAQL only. Mutations are rejected.

Writes are opt-in and never delete. `ads_mutate` runs any create or update operation through `googleAds:mutate`, and typed tools cover common tasks: `ads_create_campaign` (Search), `ads_create_demand_gen_campaign` (YouTube), `ads_create_asset`, `ads_create_ad_group`, `ads_add_keywords`, `ads_create_responsive_search_ad`, `ads_set_status`, `ads_update_budget` and `ads_set_targeting`. All of them pass the policy in `api/write-policy.ts`: removes only for links and targeting criteria, no `REMOVED` status, new campaigns PAUSED, budget caps, a customer allowlist, validation by default and explicit confirmation to execute. Classic Video campaigns cannot be created or edited through the API, so YouTube uses Demand Gen. See [Google Ads writes](campaign-creation.md) for settings, deployment and test prompts.
