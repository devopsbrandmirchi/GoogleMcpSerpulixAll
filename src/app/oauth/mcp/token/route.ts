import { logger } from "@/lib/logger";
import {
  clientSecretMatches,
  extractBasicClientSecret,
  resolveClient,
  verifyPkce,
} from "@/mcp/oauth/clients";
import { corsJson, corsOptions } from "@/mcp/oauth/metadata";
import {
  accessTokenExpiresIn,
  issueAccessToken,
  issueRefreshToken,
  readAuthorizationCode,
  readRefreshToken,
} from "@/mcp/oauth/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function oauthError(error: string, description: string, status = 400): Response {
  return corsJson({ error, error_description: description }, status);
}

function tokenResponse(clientId: string, sub: string, scope: string, sid?: string): Response {
  return corsJson({
    access_token: issueAccessToken({ clientId, sub, sid, scope }),
    token_type: "Bearer",
    expires_in: accessTokenExpiresIn(),
    refresh_token: issueRefreshToken({ clientId, sub, sid, scope }),
    scope,
  });
}

export function OPTIONS() {
  return corsOptions();
}

async function readTokenParams(req: Request): Promise<URLSearchParams> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await req.json()) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
    return params;
  }
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data") ||
    !contentType
  ) {
    const form = await req.formData();
    const params = new URLSearchParams();
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") {
        params.set(key, value);
      }
    }
    return params;
  }
  throw new Error("unsupported_content_type");
}

export async function POST(req: Request) {
  let params: URLSearchParams;
  try {
    params = await readTokenParams(req);
  } catch (error) {
    if (error instanceof Error && error.message === "unsupported_content_type") {
      return oauthError(
        "invalid_request",
        "The token endpoint accepts application/x-www-form-urlencoded or application/json.",
        415,
      );
    }
    return oauthError("invalid_request", "The token request body could not be parsed.");
  }

  const grantType = params.get("grant_type") ?? "";
  const basic = extractBasicClientSecret(req);
  const clientId = params.get("client_id") ?? basic.clientId ?? "";
  const clientSecret = params.get("client_secret") || basic.clientSecret || undefined;

  if (!clientId) {
    return oauthError("invalid_client", "client_id is required.", 401);
  }

  try {
    const client = await resolveClient(clientId);
    if (!clientSecretMatches(client, clientSecret)) {
      return oauthError("invalid_client", "Client authentication failed.", 401);
    }

    if (grantType === "authorization_code") {
      const code = params.get("code") ?? "";
      const redirectUri = params.get("redirect_uri") ?? "";
      const codeVerifier = params.get("code_verifier") ?? "";
      const payload = readAuthorizationCode(code);
      if (payload.client_id !== clientId || payload.redirect_uri !== redirectUri) {
        return oauthError("invalid_grant", "The authorization code does not match this client.");
      }
      if (!verifyPkce(codeVerifier, payload.code_challenge)) {
        return oauthError("invalid_grant", "PKCE verification failed.");
      }
      logger.info("Issued MCP access token", { operatorId: payload.sub, sessionId: payload.sid });
      return tokenResponse(clientId, payload.sub, payload.scope, payload.sid);
    }

    if (grantType === "refresh_token") {
      const refreshToken = params.get("refresh_token") ?? "";
      const payload = readRefreshToken(refreshToken);
      if (payload.client_id !== clientId) {
        return oauthError("invalid_grant", "The refresh token does not match this client.");
      }
      logger.info("Refreshed MCP access token", { operatorId: payload.sub, sessionId: payload.sid });
      return tokenResponse(clientId, payload.sub, payload.scope, payload.sid);
    }

    return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    logger.error("MCP token exchange failed", { grantType, reason });
    if (
      reason.includes("Unknown OAuth client") ||
      reason.includes("metadata") ||
      reason.includes("self-referential")
    ) {
      return oauthError("invalid_client", "The OAuth client could not be resolved.", 401);
    }
    return oauthError("invalid_grant", "The authorization code or refresh token is not valid.");
  }
}
