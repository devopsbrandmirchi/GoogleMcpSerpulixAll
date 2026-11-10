# Google Ads writes through Claude

The connector can create and edit almost anything in Google Ads, but it never deletes. Every write tool builds operations for one atomic `GoogleAdsService.Mutate` call (`customers/{id}/googleAds:mutate`, API v25). Each call passes the same server-side policy in `src/products/google-ads/api/write-policy.ts` and the same executor in `src/products/google-ads/api/mutate.ts`.

## Tools

| Tool | What it does |
|---|---|
| `ads_mutate` | Any create or update operation the API supports, in REST JSON form, up to 100 per call |
| `ads_create_campaign` | Budget plus a PAUSED Search campaign with Manual CPC |
| `ads_create_demand_gen_campaign` | Budget, a PAUSED Demand Gen campaign, an ad group with YouTube channel controls, optional location and language targeting, and an optional video responsive ad |
| `ads_create_asset` | Text asset, YouTube video asset, or image asset from a public https URL |
| `ads_create_ad_group` | Search or Display ad group in an existing campaign (PAUSED by default) |
| `ads_add_keywords` | Positive ad group keywords, or ad group and campaign negative keywords |
| `ads_create_responsive_search_ad` | Responsive search ad (PAUSED by default) |
| `ads_set_status` | Set campaigns, ad groups, ads, keywords or asset groups to ENABLED or PAUSED |
| `ads_update_budget` | Change a budget's daily amount, total amount or name |
| `ads_set_targeting` | Add or remove locations, languages, devices, ad schedules, audiences, age ranges and genders |

`ads_mutate` covers everything the typed tools don't, for example Performance Max, bidding strategies, conversion actions, sitelinks and other assets, labels and campaign settings. It uses negative temporary IDs such as `customers/123/campaignBudgets/-1` so later operations in the same request can reference resources created earlier in it.

## YouTube

Google's API cannot create or edit classic Video campaigns; it can only read them. YouTube ads are therefore built as **Demand Gen** campaigns. Their ad group channel controls can be limited to YouTube in-stream, in-feed and Shorts, and that is the default in `ads_create_demand_gen_campaign`. Videos must already be uploaded to YouTube; pass their 11-character video IDs. The logo must be an existing image asset, which `ads_create_asset` can create from an https URL.

## Rules enforced on every write

- **No deletes:** a `remove` is allowed only for links and targeting criteria. Those are campaign and ad group criteria, customer negatives, shared criteria and shared set links, asset links, asset set links, asset group signals and listing group filters, bid modifiers, label links and customizers. Removing a positive keyword is blocked after a lookup; pause it instead. Removing budgets, campaigns, ad groups, ads, assets, asset groups, bidding strategies, shared sets, labels or conversion actions is blocked, and any operation type not on the allowed list is blocked by default.
- **No REMOVED status:** any create or update that sets `status` to `REMOVED` is rejected.
- **Paused campaigns:** new campaigns are always created PAUSED. Enabling a campaign is a separate status update with confirmation, and it can start spending.
- **Budget caps:** budget `amountMicros` must not exceed `GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS`. Custom-period `totalAmountMicros` is blocked unless `GOOGLE_ADS_MAX_TOTAL_BUDGET_MICROS` is set, and must not exceed it. Bids and bidding targets are not capped.
- **One customer:** every `customers/{id}/...` resource name in a request must belong to the requested customer. Manager (MCC) accounts are rejected; write to client accounts.
- **Dry run first:** every tool defaults to `validateOnly=true`, which saves nothing. Executing requires `validateOnly=false` and `confirm=true`. The confirmation flag is a tool contract, not a separate human-authentication mechanism, and a validated plan is not bound to the later execution, so review the execution input too.
- **No retries:** each write is sent once with `partialFailure=false`. After an ambiguous timeout, read the resources before trying again, because the request might have succeeded.

Some edits are replacements in Google Ads: keyword text and most ad text cannot be changed in place. Pause the old keyword or ad and add a new one.

## 1. Prepare a Google Ads account

Start with a test manager and test client account: https://developers.google.com/google-ads/api/docs/best-practices/test-accounts . Test accounts do not serve ads or incur charges. Connect a Google user with edit access to the test client. The existing `adwords` OAuth scope covers writes. A developer token with Test access only works with test accounts; live accounts need Basic or Standard access.

## 2. Configure the server

```dotenv
GOOGLE_ADS_WRITES_ENABLED=true
GOOGLE_ADS_WRITE_CUSTOMER_IDS=1234567890
GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS=10000000
# Optional; total (custom-period) budgets stay blocked without it.
GOOGLE_ADS_MAX_TOTAL_BUDGET_MICROS=
```

`GOOGLE_ADS_WRITE_CUSTOMER_IDS` takes comma-separated client IDs. `*` allows any client account the connected Google user can access, so Claude supplies the customer ID per request; the other rules above still apply. An empty value blocks all writes, including validation. Amounts are in micros of each account's currency (1000000 = 1 unit), and the same numbers apply to every account. The daily cap limits the configured average daily budget, not actual daily spend.

## 3. Deploy

```powershell
.\scripts\cloud-run-deploy.ps1 -ProjectId YOUR_PROJECT -Region us-central1
gcloud run services update google-mcp-serpulix-all --project YOUR_PROJECT --region us-central1 --update-env-vars "GOOGLE_ADS_WRITES_ENABLED=true,GOOGLE_ADS_WRITE_CUSTOMER_IDS=1234567890,GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS=10000000"
```

For several customer IDs on the command line, use a gcloud environment YAML file, because commas also separate gcloud settings. In the Cloud Console (Edit & deploy new revision, Variables & Secrets) commas can be typed directly.

## 4. Refresh Claude and test

Refresh the custom connector at `https://YOUR_SERVICE/mcp` so Claude discovers the write tools, and set them to "Needs approval" in the connector settings. Ask Claude to list accessible Ads accounts and identify the test client first.

Example Search flow:

> In customer 1234567890, validate a paused Search campaign named Connector test with dailyBudgetMicros 1000000 (no EU political advertising), an ad group, the phrase keywords "running shoes" and "trail shoes", and a responsive search ad for https://example.com. Use validateOnly=true and show me the plan.

Example YouTube flow:

> Create an image asset named Logo from https://example.com/logo.png in customer 1234567890, then validate a Demand Gen campaign named YouTube test with dailyBudgetMicros 2000000, YouTube in-stream and Shorts only, targeting India (location 2356), with a video ad using YouTube video dQw4w9WgXcQ and that logo. Use validateOnly=true.

After reviewing a successful validation, ask Claude to run the same input with `validateOnly=false` and `confirm=true`. Check the result with `ads_campaigns` or in Google Ads.

## Troubleshooting and rollback

- Tools missing: deploy the updated code and refresh Claude's connector tool list.
- Disabled, not allowlisted or budget errors: check the environment settings on the running revision.
- "would delete an entity" or "Pause it instead": the request tried a blocked remove; use `ads_set_status` with PAUSED.
- 403 from Google: check the Google user's edit rights, the developer token access level, project access and MCC access to the client.
- Validation errors: correct the fields Google reports; the error text comes from the API.
- To turn off all writes: set `GOOGLE_ADS_WRITES_ENABLED=false`. Created resources remain; remove test resources in the Google Ads UI if needed.
