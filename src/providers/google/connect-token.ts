import { getConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { nowSeconds, signJwt, verifyJwt } from "@/mcp/oauth/jwt";

export interface ConnectTokenPayload {
  typ: "connect";
  operatorId: string;
  operation: "add_connection" | "reconnect";
  connectionId?: string;
  exp: number;
  iat: number;
}

export function issueConnectToken(params: {
  operatorId: string;
  operation?: "add_connection" | "reconnect";
  connectionId?: string;
}): string {
  return signJwt({
    typ: "connect",
    operatorId: params.operatorId,
    operation: params.operation ?? "add_connection",
    connectionId: params.connectionId,
    iat: nowSeconds(),
    exp: nowSeconds() + 15 * 60,
  });
}

export function readConnectToken(token: string): ConnectTokenPayload {
  const payload = verifyJwt<ConnectTokenPayload>(token);
  if (payload.typ !== "connect" || !payload.operatorId) {
    throw new AppError("The Google connection link is invalid.", "unauthorized", 401);
  }
  return payload;
}

export function connectUrl(token: string): string {
  return `${getConfig().appBaseUrl}/oauth/google/connect?t=${encodeURIComponent(token)}`;
}
