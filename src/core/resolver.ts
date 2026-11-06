import { AppError } from "@/lib/errors";
import { resolveAuthorizedProperty, type ResolvedProperty } from "@/products/ga4/routing";
import { resolveAdsAccessContext, type ResolvedAdsAccess } from "@/products/google-ads/routing";
import {
  resolveDv360AdvertiserAccess,
  type ResolvedDv360Access,
} from "@/products/dv360/routing";
import type { ProductId } from "@/store/types";

export type ProductAccessContext = ResolvedProperty | ResolvedAdsAccess | ResolvedDv360Access;

export async function resolveAccess(params: {
  product: ProductId;
  resourceId?: string;
  connectionId?: string;
}): Promise<ProductAccessContext> {
  if (params.product === "ga4") {
    return resolveAuthorizedProperty(params.resourceId, params.connectionId);
  }
  if (params.product === "google_ads") {
    return resolveAdsAccessContext(params.resourceId, params.connectionId);
  }
  if (params.product === "dv360") {
    return resolveDv360AdvertiserAccess(params.resourceId, params.connectionId);
  }
  throw new AppError("Unsupported product.", "validation", 400);
}
