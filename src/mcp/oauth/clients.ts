import { createHash } from "node:crypto";
import { getConfig } from "@/lib/config";
import { tokensEqual } from "@/lib/secure-compare";
import { signJwt, verifyJwt } from "@/mcp/oauth/jwt";

export const CLAUDE_AI_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
export const CLAUDE_COM_CALLBACK = "https://claude.com/api/mcp/auth_callback";

const CLAUDE_HOSTS = new Set(["claude.ai", "www.claude.ai", "claude.com", "www.claude.com"]);

export interface ResolvedClient {
  clientId: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: "none" | "client_secret_post" | "client_secret_basic";
  clientSecret?: string;
  displayHost: string;
}

interface DcrClientPayload {
  typ: "dcr_client";
  redirect_uris: string[];
  token_endpoint_auth_method: string;
}

interface CimdDocument {
  client_id?: string;
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function redirectUriMatches(allowed: string, requested: string): boolean {
  if (allowed === requested) {
    return true;
  }

  try {
    const allowedUrl = new URL(allowed);
    const requestedUrl = new URL(requested);
    if (!isLoopbackHost(allowedUrl.hostname) || !isLoopbackHost(requestedUrl.hostname)) {
      return false;
    }
    return (
      allowedUrl.protocol === requestedUrl.protocol &&
      allowedUrl.hostname === requestedUrl.hostname &&
      allowedUrl.pathname === requestedUrl.pathname
    );
  } catch {
    return false;
  }
}

export function isRedirectAllowed(client: ResolvedClient, redirectUri: string): boolean {
  return client.redirectUris.some((allowed) => redirectUriMatches(allowed, redirectUri));
}

export function createDcrClientId(params: {
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
}): string {
  return `dcr.${signJwt({
    typ: "dcr_client",
    redirect_uris: params.redirectUris,
    token_endpoint_auth_method: params.tokenEndpointAuthMethod,
  })}`;
}

function resolvePreRegistered(clientId: string): ResolvedClient | undefined {
  const config = getConfig();
  if (!config.mcpOAuthClientId || clientId !== config.mcpOAuthClientId) {
    return undefined;
  }
  return {
    clientId,
    redirectUris: [CLAUDE_AI_CALLBACK, CLAUDE_COM_CALLBACK],
    tokenEndpointAuthMethod: config.mcpOAuthClientSecret ? "client_secret_post" : "none",
    clientSecret: config.mcpOAuthClientSecret,
    displayHost: "pre-registered",
  };
}

function resolveDcrClient(clientId: string): ResolvedClient | undefined {
  if (!clientId.startsWith("dcr.")) {
    return undefined;
  }
  try {
    const payload = verifyJwt<DcrClientPayload>(clientId.slice(4));
    if (payload.typ !== "dcr_client" || !Array.isArray(payload.redirect_uris)) {
      return undefined;
    }
    return {
      clientId,
      redirectUris: payload.redirect_uris,
      tokenEndpointAuthMethod:
        payload.token_endpoint_auth_method === "client_secret_post"
          ? "client_secret_post"
          : payload.token_endpoint_auth_method === "client_secret_basic"
            ? "client_secret_basic"
            : "none",
      displayHost: "dynamic-client",
    };
  } catch {
    return undefined;
  }
}

function resolveClaudeClient(clientId: string): ResolvedClient | undefined {
  try {
    const url = new URL(clientId);
    if (url.protocol !== "https:" || !CLAUDE_HOSTS.has(url.hostname)) {
      return undefined;
    }
    return {
      clientId,
      redirectUris: [CLAUDE_AI_CALLBACK, CLAUDE_COM_CALLBACK],
      tokenEndpointAuthMethod: "none",
      displayHost: url.host,
    };
  } catch {
    return undefined;
  }
}

export async function resolveClient(clientId: string): Promise<ResolvedClient> {
  const preRegistered = resolvePreRegistered(clientId);
  if (preRegistered) {
    return preRegistered;
  }

  const dcr = resolveDcrClient(clientId);
  if (dcr) {
    return dcr;
  }

  const claude = resolveClaudeClient(clientId);
  if (claude) {
    return claude;
  }

  if (clientId.startsWith("https://")) {
    const response = await fetch(clientId, {
      headers: { Accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error("Could not load the client ID metadata document.");
    }
    const document = (await response.json()) as CimdDocument;
    if (document.client_id !== clientId) {
      throw new Error("Client ID metadata document is not self-referential.");
    }
    const redirectUris = document.redirect_uris ?? [];
    if (new URL(clientId).hostname === "claude.ai" && !redirectUris.includes(CLAUDE_AI_CALLBACK)) {
      redirectUris.push(CLAUDE_AI_CALLBACK);
    }
    return {
      clientId,
      redirectUris,
      tokenEndpointAuthMethod: "none",
      displayHost: new URL(clientId).host,
    };
  }

  throw new Error("Unknown OAuth client.");
}

export function clientSecretMatches(client: ResolvedClient, presented?: string): boolean {
  if (client.tokenEndpointAuthMethod === "none") {
    return true;
  }
  if (!client.clientSecret || !presented) {
    return false;
  }
  return tokensEqual(presented, client.clientSecret);
}

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const digest = createHash("sha256").update(codeVerifier).digest("base64url");
  return tokensEqual(digest, codeChallenge);
}

export function extractBasicClientSecret(req: Request): {
  clientId?: string;
  clientSecret?: string;
} {
  const header = req.headers.get("authorization");
  const match = header?.match(/^Basic\s+(.+)$/i);
  if (!match?.[1]) {
    return {};
  }
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) {
    return {};
  }
  return {
    clientId: decoded.slice(0, separator),
    clientSecret: decoded.slice(separator + 1),
  };
}
