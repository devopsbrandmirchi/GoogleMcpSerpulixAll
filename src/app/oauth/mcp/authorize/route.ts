import { buildGoogleAuthUrl, createPkcePair, createSignedOAuthState, verifyOAuthState } from "@/providers/google/auth";
import { escapeHtml, htmlResponse, pageHtml } from "@/lib/html";
import { logger } from "@/lib/logger";
import { oauthCookieHeaders, requestIsHttps } from "@/lib/oauth-cookies";
import { isRedirectAllowed, resolveClient } from "@/mcp/oauth/clients";
import { MCP_SCOPE } from "@/mcp/oauth/metadata";
import type { PendingMcpAuthorize } from "@/mcp/oauth/pending";
import { getAppStore } from "@/store/app-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AuthorizeQuery {
  responseType: string | null;
  clientId: string | null;
  redirectUri: string | null;
  state: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  scope: string | null;
}

function readQuery(url: URL): AuthorizeQuery {
  return {
    responseType: url.searchParams.get("response_type"),
    clientId: url.searchParams.get("client_id"),
    redirectUri: url.searchParams.get("redirect_uri"),
    state: url.searchParams.get("state"),
    codeChallenge: url.searchParams.get("code_challenge"),
    codeChallengeMethod: url.searchParams.get("code_challenge_method"),
    scope: url.searchParams.get("scope"),
  };
}

async function validateRequest(query: AuthorizeQuery) {
  if (query.responseType !== "code" || !query.clientId || !query.redirectUri) {
    throw new Error("The authorization request is missing response_type, client_id, or redirect_uri.");
  }
  if (!query.codeChallenge || query.codeChallengeMethod !== "S256") {
    throw new Error("This server requires PKCE with code_challenge_method=S256.");
  }

  const client = await resolveClient(query.clientId);
  if (!isRedirectAllowed(client, query.redirectUri)) {
    throw new Error("The redirect_uri is not registered for this client.");
  }
  return client;
}

export async function GET(req: Request) {
  const query = readQuery(new URL(req.url));
  try {
    const client = await validateRequest(query);
    const pending: PendingMcpAuthorize = {
      clientId: query.clientId as string,
      redirectUri: query.redirectUri as string,
      codeChallenge: query.codeChallenge as string,
      scope: query.scope || MCP_SCOPE,
      state: query.state,
      exp: Date.now() + 15 * 60 * 1000,
    };

    const { verifier, challenge } = createPkcePair();
    const googleState = createSignedOAuthState("bootstrap_operator");
    const parsedState = verifyOAuthState(googleState);
    await getAppStore().createTransaction({
      nonce: parsedState.nonce,
      operatorId: null,
      operation: "bootstrap_operator",
      connectionId: null,
      mcpPending: pending,
      codeVerifier: verifier,
      googleState,
      exp: parsedState.exp,
    });

    const googleUrl = buildGoogleAuthUrl({
      state: googleState,
      codeChallenge: challenge,
    });

    logger.info("Starting Flow 1 operator bootstrap", {
      displayHost: client.displayHost,
    });

    const headers = new Headers({ Location: googleUrl });
    for (const cookie of oauthCookieHeaders({
      state: googleState,
      verifier,
      pending,
      secure: requestIsHttps(req),
    })) {
      headers.append("Set-Cookie", cookie);
    }
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return htmlResponse(
      pageHtml(
        "Authorization request rejected",
        `<h1>Authorization request rejected</h1><p class="error">${escapeHtml(
          error instanceof Error ? error.message : "Invalid request",
        )}</p>`,
      ),
      400,
    );
  }
}

export async function POST(req: Request) {
  return GET(
    new Request(`${new URL(req.url).origin}/oauth/mcp/authorize?${new URL(req.url).searchParams}`, {
      method: "GET",
      headers: req.headers,
    }),
  );
}
