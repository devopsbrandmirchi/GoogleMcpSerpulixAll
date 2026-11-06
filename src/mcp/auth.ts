import type { AuthInfo } from "@modelcontextprotocol/server";
import { extractMcpToken as extractBearer } from "@/mcp/http";
import { readAccessToken, type AccessTokenPayload } from "@/mcp/oauth/tokens";

export function extractMcpToken(req: Request): string | undefined {
  return extractBearer(req);
}

export function tryReadAccessToken(token: string | undefined): AccessTokenPayload | undefined {
  if (!token) {
    return undefined;
  }
  try {
    return readAccessToken(token);
  } catch {
    return undefined;
  }
}

export async function isAuthorizedToken(token: string | undefined): Promise<boolean> {
  return Boolean(tryReadAccessToken(token)?.sub);
}

export async function verifyMcpToken(
  req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  const token = bearerToken?.trim() || extractMcpToken(req);
  const payload = tryReadAccessToken(token);
  if (!token || !payload) {
    return undefined;
  }
  return {
    token,
    scopes: payload.scope.split(/\s+/).filter(Boolean),
    clientId: payload.client_id,
    expiresAt: payload.exp,
  };
}
