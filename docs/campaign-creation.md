# Campaign creation through Claude

`ads_create_campaign` creates a PAUSED Search campaign and a dedicated daily budget in one atomic Google Ads mutation. It uses Manual CPC bidding and Google Search only. It does not create ad groups, keywords, ads, targeting, or enable campaigns. Existing reporting tools remain read-only.

## 1. Prepare a Google Ads account

Start with a test manager and test client account: https://developers.google.com/google-ads/api/docs/best-practices/test-accounts . Test accounts do not serve ads or incur charges. Connect a Google user with edit access to the test client. Create campaigns in the client account, not the manager. Existing `adwords` OAuth scope covers writes; no separate write scope is required. Production use also requires appropriate developer-token/project access and permissible use for campaign management.

## 2. Enable only the intended client

For local development, add these settings to your private `.env` and restart the server:

```dotenv
GOOGLE_ADS_WRITES_ENABLED=true
GOOGLE_ADS_WRITE_CUSTOMER_IDS=1234567890
GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS=10000000
```

Replace the example customer ID. The limit is in micros of the account currency: 1000000 micros = 1 currency unit. This is a limit on the configured average daily budget, not a guaranteed daily spending ceiling. The same numeric limit applies to every allowlisted account regardless of currency. Writes remain disabled by default, including validation.

## 3. Deploy the updated code

From the repo root, with gcloud authenticated and your existing service already configured:

```powershell
.\scripts\cloud-run-deploy.ps1 -ProjectId YOUR_PROJECT -Region us-central1
gcloud run services update google-mcp-serpulix-all --project YOUR_PROJECT --region us-central1 --update-env-vars "GOOGLE_ADS_WRITES_ENABLED=true,GOOGLE_ADS_WRITE_CUSTOMER_IDS=1234567890,GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS=10000000"
```

This example allowlists one account; for multiple accounts use a gcloud environment YAML file because commas also delimit gcloud settings. Existing OAuth, encryption, Firestore and developer-token settings must remain configured. These commands deploy your current local source. No deployment is performed automatically by editing the repo.

## 4. Refresh Claude and validate

Refresh/reconnect the Claude custom connector at your existing `https://YOUR_SERVICE/mcp` URL so it discovers `ads_create_campaign`. If your test account is missing, reconnect the Google connection with `google_connections_start` to refresh discovery. Ask Claude to list accessible Ads accounts and identify the test client first.

Example prompt:

> Validate a new paused Search campaign named Connector test 2026-11-09 in customer 1234567890, with dailyBudgetMicros 1000000. It does not contain EU political advertising. Use ads_create_campaign with validateOnly=true. Show me the plan and do not create anything yet.

Equivalent tool input:

```json
{
  "customerId": "1234567890",
  "name": "Connector test 2026-11-09",
  "dailyBudgetMicros": "1000000",
  "containsEuPoliticalAdvertising": "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
  "validateOnly": true
}
```

Use the truthful political-advertising declaration for your campaign. Validation saves nothing. After reviewing a successful validation, explicitly ask Claude to create that exact campaign with `validateOnly=false` and `confirm=true`. The confirmation flag is a tool contract, not a separate human-authentication mechanism. Then call `ads_campaigns` or inspect Google Ads to confirm the new campaign is PAUSED. A validated plan is not stored or cryptographically bound to execution; review the execution input as well.

## Troubleshooting and rollback

- Tool missing: deploy updated code and refresh Claude's connector tool list.
- Disabled/not allowlisted/budget error: check the three environment settings on the running revision.
- 403 from Google: check Google user edit rights, developer token, project access, permissible use, and MCC access to the client.
- Validation errors: correct the Google-reported fields; the current tool supports only basic Search/Manual CPC creation.
- Timeout during execution: inspect campaigns before retrying. The API call is not idempotent and a timed-out request might have succeeded.
- To disable creation: set `GOOGLE_ADS_WRITES_ENABLED=false` on the service. Previously created campaigns/budgets remain; remove test resources through Google Ads if desired.

No live API mutation is required for the automated tests. First test the complete validation and creation flow against a Google test account after deployment.
