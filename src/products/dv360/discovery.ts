import type { OAuth2Client } from "google-auth-library";
import { logger } from "@/lib/logger";
import { listDv360CollectionAll, requireAccessToken } from "@/products/dv360/api/client";
import type { DiscoveredDv360Advertiser, DiscoveredDv360Partner } from "@/store/types";

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export function idFromResourceName(name: unknown, prefix: string): string | null {
  if (typeof name !== "string") {
    return null;
  }
  const match = name.trim().match(new RegExp(`(?:^|/)${prefix}/(\\d+)$`));
  return match?.[1] ?? null;
}

function generalConfig(resource: Record<string, unknown>): Record<string, unknown> {
  const config = resource.generalConfig;
  return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

export function mapDiscoveredPartner(resource: Record<string, unknown>): DiscoveredDv360Partner | null {
  const partnerId = asString(resource.partnerId) ?? idFromResourceName(resource.name, "partners");
  if (!partnerId) {
    return null;
  }
  const config = generalConfig(resource);
  return {
    partnerId,
    displayName: asString(resource.displayName) ?? partnerId,
    entityStatus: asString(resource.entityStatus),
    currencyCode: asString(config.currencyCode),
    timeZone: asString(config.timeZone),
  };
}

export function mapDiscoveredAdvertiser(
  resource: Record<string, unknown>,
  fallbackPartnerId?: string,
): DiscoveredDv360Advertiser | null {
  const advertiserId =
    asString(resource.advertiserId) ?? idFromResourceName(resource.name, "advertisers");
  const partnerId =
    asString(resource.partnerId) ??
    fallbackPartnerId ??
    idFromResourceName(resource.name, "partners") ??
    null;
  if (!advertiserId || !partnerId) {
    return null;
  }
  const config = generalConfig(resource);
  return {
    partnerId,
    advertiserId,
    displayName: asString(resource.displayName) ?? advertiserId,
    entityStatus: asString(resource.entityStatus),
    currencyCode: asString(config.currencyCode),
    timeZone: asString(config.timeZone),
  };
}

export async function discoverDv360Resources(
  client: OAuth2Client,
): Promise<{ partners: DiscoveredDv360Partner[]; advertisers: DiscoveredDv360Advertiser[] }> {
  const accessToken = requireAccessToken((await client.getAccessToken()).token);
  const partnerPage = await listDv360CollectionAll({
    path: "/partners",
    accessToken,
    itemsKey: "partners",
  });
  const partners: DiscoveredDv360Partner[] = [];
  for (const item of partnerPage.items) {
    const mapped = mapDiscoveredPartner(item);
    if (mapped) {
      partners.push(mapped);
    }
  }

  const advertisers: DiscoveredDv360Advertiser[] = [];
  const partnerIds = partners.map((item) => item.partnerId);
  if (partnerIds.length === 0) {
    try {
      const advertiserPage = await listDv360CollectionAll({
        path: "/advertisers",
        accessToken,
        itemsKey: "advertisers",
      });
      for (const item of advertiserPage.items) {
        const mapped = mapDiscoveredAdvertiser(item);
        if (mapped) {
          advertisers.push(mapped);
        }
      }
    } catch (error) {
      logger.warn("Could not load DV360 advertisers without partner filter", {
        errorCategory: error instanceof Error ? error.name : "unknown",
      });
    }
  } else {
    for (const partner of partners) {
      try {
        const advertiserPage = await listDv360CollectionAll({
          path: "/advertisers",
          accessToken,
          itemsKey: "advertisers",
          extraQuery: { partnerId: partner.partnerId },
        });
        for (const item of advertiserPage.items) {
          const mapped = mapDiscoveredAdvertiser(item, partner.partnerId);
          if (mapped) {
            advertisers.push(mapped);
          }
        }
      } catch (error) {
        logger.warn("Could not load DV360 advertisers for partner", {
          partnerId: partner.partnerId,
          errorCategory: error instanceof Error ? error.name : "unknown",
        });
      }
    }
  }

  if (partners.length === 0 && advertisers.length > 0) {
    const uniquePartners = new Map<string, DiscoveredDv360Partner>();
    for (const advertiser of advertisers) {
      if (!uniquePartners.has(advertiser.partnerId)) {
        uniquePartners.set(advertiser.partnerId, {
          partnerId: advertiser.partnerId,
          displayName: advertiser.partnerId,
          entityStatus: null,
          currencyCode: advertiser.currencyCode,
          timeZone: advertiser.timeZone,
        });
      }
    }
    partners.push(...uniquePartners.values());
  }

  return { partners, advertisers };
}
