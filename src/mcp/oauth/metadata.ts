import { getConfig } from "@/lib/config";

export const MCP_SCOPE = "gconnect:read";

export function mcpResourceUrl(): string {
  return `${getConfig().appBaseUrl}/mcp`;
}

export function protectedResourceMetadata() {
  const baseUrl = getConfig().appBaseUrl;
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [baseUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: [MCP_SCOPE],
  };
}

export function authorizationServerMetadata() {
  const baseUrl = getConfig().appBaseUrl;
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/mcp/authorize`,
    token_endpoint: `${baseUrl}/oauth/mcp/token`,
    registration_endpoint: `${baseUrl}/oauth/mcp/register`,
    scopes_supported: [MCP_SCOPE, "offline_access"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
  };
}

export function wwwAuthenticateHeader(): string {
  const metadataUrl = `${getConfig().appBaseUrl}/.well-known/oauth-protected-resource/mcp`;
  return `Bearer error="invalid_token", error_description="Authentication required", resource_metadata="${metadataUrl}", scope="${MCP_SCOPE}"`;
}

export function corsJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export function corsOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
