import { MCP_SCOPE } from "@/mcp/oauth/metadata";
import { issueAuthorizationCode } from "@/mcp/oauth/tokens";
import type { PendingMcpAuthorize } from "@/mcp/oauth/pending";

export function mcpAuthorizeRedirectUrl(
  pending: PendingMcpAuthorize,
  operatorId: string,
  sessionId: string,
): string {
  const code = issueAuthorizationCode({
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    codeChallenge: pending.codeChallenge,
    sub: operatorId,
    sid: sessionId,
    scope: pending.scope || MCP_SCOPE,
  });

  const url = new URL(pending.redirectUri);
  url.searchParams.set("code", code);
  if (pending.state) {
    url.searchParams.set("state", pending.state);
  }
  return url.toString();
}

export function oauthRedirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location },
  });
}
