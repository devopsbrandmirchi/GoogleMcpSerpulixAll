import { createOAuthClient, connectionScopes, type GoogleIdentity } from "@/providers/google/auth";
import { persistDiscoveredGa4Resources } from "@/products/ga4/routing";
import { persistDiscoveredAdsResources } from "@/products/google-ads/routing";
import { persistDiscoveredDv360Resources } from "@/products/dv360/routing";
import { encryptRefreshToken } from "@/lib/crypto";
import { DV360_SCOPE, GA4_READONLY_SCOPE, GOOGLE_ADS_SCOPE } from "@/lib/config";
import { logger } from "@/lib/logger";
import { getAppStore } from "@/store/app-store";
import type { GoogleConnectionRecord, OperatorRecord } from "@/store/types";

export async function bindGoogleIdentityToOperator(params: {
  operatorId: string;
  identity: GoogleIdentity;
  encryptedRefreshToken?: string | null;
}): Promise<{ operator: OperatorRecord; connection: GoogleConnectionRecord }> {
  const store = getAppStore();
  const operator = await store.getOperator(params.operatorId);
  if (!operator) {
    throw new Error("The operator no longer exists.");
  }

  const encrypted =
    params.identity.refreshToken
      ? encryptRefreshToken(params.identity.refreshToken)
      : params.encryptedRefreshToken || undefined;

  const connection = await store.upsertConnection({
    operatorId: params.operatorId,
    googleSubjectId: params.identity.googleSubjectId,
    googleEmail: params.identity.email,
    googleDisplayName: params.identity.displayName,
    encryptedRefreshToken: encrypted,
    scopes: params.identity.scopes.length > 0 ? params.identity.scopes : connectionScopes(),
  });

  if (connection.refreshTokenEncrypted) {
    const client = createOAuthClient();
    const { decryptRefreshToken } = await import("@/lib/crypto");
    client.setCredentials({
      refresh_token: decryptRefreshToken(connection.refreshTokenEncrypted),
    });
    if (connection.scopes.includes(GA4_READONLY_SCOPE)) {
      try {
        await persistDiscoveredGa4Resources(params.operatorId, connection.connectionId, client);
      } catch (error) {
        logger.warn("GA4 discovery failed after bind", {
          operatorId: params.operatorId,
          connectionId: connection.connectionId,
          errorCategory: error instanceof Error ? error.name : "unknown",
          errorMessage: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    if (connection.scopes.includes(GOOGLE_ADS_SCOPE)) {
      try {
        await persistDiscoveredAdsResources(params.operatorId, connection.connectionId, client);
      } catch (error) {
        logger.warn("Google Ads discovery failed after bind", {
          operatorId: params.operatorId,
          connectionId: connection.connectionId,
          errorCategory: error instanceof Error ? error.name : "unknown",
          errorMessage: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    if (connection.scopes.includes(DV360_SCOPE)) {
      try {
        await persistDiscoveredDv360Resources(params.operatorId, connection.connectionId, client);
      } catch (error) {
        logger.warn("DV360 discovery failed after bind", {
          operatorId: params.operatorId,
          connectionId: connection.connectionId,
          errorCategory: error instanceof Error ? error.name : "unknown",
          errorMessage: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }

  return { operator, connection };
}

export async function createOperatorWithConnection(
  identity: GoogleIdentity,
  encryptedRefreshToken?: string | null,
) {
  const operator = await getAppStore().createOperator(identity.email);
  return bindGoogleIdentityToOperator({
    operatorId: operator.operatorId,
    identity,
    encryptedRefreshToken,
  });
}
