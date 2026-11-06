import { v1beta } from "@google-analytics/admin";
import type { OAuth2Client } from "google-auth-library";
import { mapGoogleError } from "@/lib/errors";
import { normalizePropertyId } from "@/lib/property-id";
import type { DiscoveredAccount, DiscoveredProperty } from "@/store/types";

/** Convert Google protobuf Timestamp (or ISO string) into a stable UTC ISO timestamp. */
export function ga4CreateTimeToIso(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "object" && "seconds" in value) {
    const stamp = value as { seconds?: number | string | { toString(): string }; nanos?: number };
    const seconds = Number(stamp.seconds);
    const nanos = Number(stamp.nanos ?? 0);
    if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) return null;
    const date = new Date(seconds * 1000 + Math.floor(nanos / 1e6));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

/** A failed lookup is non-destructive; callers retain any stored timestamp. */
export async function fetchGa4PropertyCreateTime(
  client: Pick<v1beta.AnalyticsAdminServiceClient, "getProperty">,
  propertyId: string,
): Promise<string | null> {
  const [property] = await client.getProperty({ name: `properties/${normalizePropertyId(propertyId)}` });
  return ga4CreateTimeToIso(property.createTime);
}

export interface Ga4DiscoveryResult {
  accounts: DiscoveredAccount[];
  properties: DiscoveredProperty[];
}

export function createAdminClient(auth: OAuth2Client): v1beta.AnalyticsAdminServiceClient {
  return new v1beta.AnalyticsAdminServiceClient({
    authClient: auth as never,
  });
}

export async function discoverGa4Resources(
  auth: OAuth2Client,
  clientFactory: (
    authClient: OAuth2Client,
  ) => v1beta.AnalyticsAdminServiceClient = createAdminClient,
): Promise<Ga4DiscoveryResult> {
  try {
    const client = clientFactory(auth);
    const accounts = new Map<string, DiscoveredAccount>();
    const properties: DiscoveredProperty[] = [];

    for await (const summary of client.listAccountSummariesAsync()) {
      const ga4AccountId = summary.account?.replace(/^accounts\//, "") || summary.name || "";
      const accountName = summary.displayName ?? "Untitled account";
      if (ga4AccountId) {
        accounts.set(ga4AccountId, {
          ga4AccountId,
          displayName: accountName,
        });
      }

      for (const property of summary.propertySummaries ?? []) {
        if (!property.property) {
          continue;
        }
        let propertyCreateTime: string | null = null;
        try {
          propertyCreateTime = await fetchGa4PropertyCreateTime(client, property.property);
        } catch {
          // Preserve discovery even if individual property metadata is unavailable.
        }
        properties.push({
          propertyCreateTime,
          ga4AccountId,
          propertyId: normalizePropertyId(property.property),
          displayName: property.displayName ?? "Untitled property",
          propertyType: String(property.propertyType ?? "PROPERTY_TYPE_ORDINARY"),
        });
      }
    }

    return {
      accounts: [...accounts.values()],
      properties,
    };
  } catch (error) {
    throw mapGoogleError(error, "ga4");
  }
}
