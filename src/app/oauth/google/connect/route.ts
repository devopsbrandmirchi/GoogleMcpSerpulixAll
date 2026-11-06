import {
  buildGoogleAuthUrl,
  createPkcePair,
  createSignedOAuthState,
  verifyOAuthState,
} from "@/providers/google/auth";
import { readConnectToken } from "@/providers/google/connect-token";
import { AppError } from "@/lib/errors";
import { escapeHtml, htmlResponse, pageHtml } from "@/lib/html";
import { logger } from "@/lib/logger";
import {
  assertOperatorCookie,
  oauthCookieHeaders,
  readOAuthCookies,
  requestIsHttps,
} from "@/lib/oauth-cookies";
import { getAppStore } from "@/store/app-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function startAddConnection(params: {
  operatorId: string;
  connectionId?: string | null;
  operation: "add_connection" | "reconnect";
  req: Request;
}) {
  const operator = await getAppStore().getOperator(params.operatorId);
  if (!operator) {
    throw new AppError("The authenticated operator was not found.", "operator_not_found", 401);
  }
  if (params.connectionId) {
    const connection = await getAppStore().getConnection(params.connectionId);
    if (!connection || connection.operatorId !== params.operatorId) {
      throw new AppError("The requested Google connection was not found.", "connection_not_found", 404);
    }
  }

  const { verifier, challenge } = createPkcePair();
  const googleState = createSignedOAuthState(params.operation);
  const parsed = verifyOAuthState(googleState);
  const cookies = readOAuthCookies(params.req);
  await getAppStore().createTransaction({
    nonce: parsed.nonce,
    operatorId: params.operatorId,
    operation: params.operation,
    connectionId: params.connectionId ?? null,
    mcpPending: cookies.pending ?? null,
    codeVerifier: verifier,
    googleState,
    exp: parsed.exp,
  });

  const googleUrl = buildGoogleAuthUrl({
    state: googleState,
    codeChallenge: challenge,
  });
  logger.info("Starting Flow 2 Google connection", {
    operatorId: params.operatorId,
    operation: params.operation,
  });

  const headers = new Headers({ Location: googleUrl });
  for (const cookie of oauthCookieHeaders({
    state: googleState,
    verifier,
    pending: cookies.pending,
    secure: requestIsHttps(params.req),
  })) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(null, { status: 302, headers });
}

export async function GET(req: Request) {
  try {
    const token = new URL(req.url).searchParams.get("t");
    if (!token) {
      throw new AppError(
        "Connect another Google Account from the authenticated operator session or Claude tool link.",
        "unauthorized",
        401,
      );
    }
    const payload = readConnectToken(token);
    return startAddConnection({
      operatorId: payload.operatorId,
      connectionId: payload.connectionId,
      operation: payload.operation,
      req,
    });
  } catch (error) {
    return htmlResponse(
      pageHtml(
        "Cannot start Google connection",
        `<h1>Cannot start Google connection</h1><p class="error">${escapeHtml(
          error instanceof Error ? error.message : "Unauthorized",
        )}</p>`,
      ),
      401,
    );
  }
}

export async function POST(req: Request) {
  try {
    const cookies = readOAuthCookies(req);
    const operator = assertOperatorCookie(cookies.operator);
    return startAddConnection({
      operatorId: operator.operatorId,
      operation: "add_connection",
      req,
    });
  } catch (error) {
    return htmlResponse(
      pageHtml(
        "Cannot start Google connection",
        `<h1>Cannot start Google connection</h1><p class="error">${escapeHtml(
          error instanceof Error ? error.message : "Unauthorized",
        )}</p>`,
      ),
      401,
    );
  }
}
