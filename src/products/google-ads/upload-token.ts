import { getConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { nowSeconds, signJwt, verifyJwt } from "@/mcp/oauth/jwt";

export const UPLOAD_TOKEN_TTL_SECONDS = 30 * 60;

export interface UploadTokenPayload {
  typ: "ads_upload";
  operatorId: string;
  sessionId?: string;
  customerId: string;
  connectionId?: string;
  iat: number;
  exp: number;
}

export function issueUploadToken(params: {
  operatorId: string;
  sessionId?: string;
  customerId: string;
  connectionId?: string;
}): string {
  return signJwt({
    typ: "ads_upload",
    operatorId: params.operatorId,
    sessionId: params.sessionId,
    customerId: params.customerId,
    connectionId: params.connectionId,
    iat: nowSeconds(),
    exp: nowSeconds() + UPLOAD_TOKEN_TTL_SECONDS,
  });
}

export function readUploadToken(token: string): UploadTokenPayload {
  let payload: UploadTokenPayload;
  try {
    payload = verifyJwt<UploadTokenPayload>(token);
  } catch {
    throw new AppError("This upload link is invalid or has expired. Ask Claude for a new one.", "unauthorized", 401);
  }
  if (payload.typ !== "ads_upload" || !payload.operatorId || !payload.customerId) {
    throw new AppError("This upload link is invalid or has expired. Ask Claude for a new one.", "unauthorized", 401);
  }
  return payload;
}

export function uploadUrl(token: string): string {
  return `${getConfig().appBaseUrl}/ads/upload?t=${encodeURIComponent(token)}`;
}
