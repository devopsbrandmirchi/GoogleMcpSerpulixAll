import { randomBytes } from "node:crypto";
import { exchangeAuthorizationCode, verifyOAuthState } from "@/providers/google/auth";
import { bindGoogleIdentityToOperator, createOperatorWithConnection } from "@/oauth/bind-connection";
import { connectionsPageHtml, resumePageHtml } from "@/oauth/pages";
import { AppError, toHttpStatus } from "@/lib/errors";
import { encryptRefreshToken } from "@/lib/crypto";
import { escapeHtml, htmlResponse, pageHtml } from "@/lib/html";
import { logger } from "@/lib/logger";
import {
  clearOAuthCookieHeaders,
  operatorCookieHeader,
  readOAuthCookies,
  requestIsHttps,
  resumeCookieHeader,
} from "@/lib/oauth-cookies";
import { createMcpSessionId } from "@/mcp/oauth/tokens";
import { getAppStore } from "@/store/app-store";
import type { ResumeCandidate } from "@/store/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appendCookies(headers: Headers, cookies: string[]): void {
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const forgedOperatorId = url.searchParams.get("operatorId");
  const secure = requestIsHttps(req);
  const cookies = readOAuthCookies(req);

  if (oauthError) {
    const deniedHeaders = new Headers();
    appendCookies(deniedHeaders, clearOAuthCookieHeaders(secure));
    return htmlResponse(
      pageHtml(
        "Google authorization denied",
        `<h1>Google authorization denied</h1><p class="error">${escapeHtml(
          oauthError,
        )}</p><p>Return to Claude and connect the connector again.</p>`,
      ),
      400,
      deniedHeaders,
    );
  }

  try {
    if (forgedOperatorId) {
      throw new AppError("Operator identity cannot be supplied by the browser.", "unauthorized", 401);
    }
    if (!code || !state || !cookies.state || !cookies.verifier) {
      throw new AppError("The Google authorization response is incomplete.", "session_invalid", 400);
    }
    if (state !== cookies.state) {
      throw new AppError("OAuth state did not match.", "unauthorized", 401);
    }
    const signed = verifyOAuthState(state);
    const transaction = await getAppStore().consumeTransaction(signed.nonce);
    if (transaction.googleState && transaction.googleState !== state) {
      throw new AppError("OAuth state did not match.", "unauthorized", 401);
    }
    if (transaction.codeVerifier && transaction.codeVerifier !== cookies.verifier) {
      throw new AppError("OAuth PKCE verifier did not match.", "unauthorized", 401);
    }

    const identity = await exchangeAuthorizationCode({
      code,
      codeVerifier: transaction.codeVerifier || cookies.verifier,
    });

    if (transaction.operation === "add_connection" || transaction.operation === "reconnect") {
      if (!transaction.operatorId) {
        throw new AppError("The Google connection was not bound to an operator.", "unauthorized", 401);
      }
      const { operator, connection } = await bindGoogleIdentityToOperator({
        operatorId: transaction.operatorId,
        identity,
      });
      logger.info("Flow 2 Google connection bound", {
        operatorId: operator.operatorId,
        connectionId: connection.connectionId,
      });
      const sessionId = cookies.operator?.sessionId || createMcpSessionId();
      const connections = await getAppStore().listConnections(operator.operatorId);
      const headers = new Headers();
      headers.append(
        "Set-Cookie",
        operatorCookieHeader({ operatorId: operator.operatorId, sessionId, secure }),
      );
      return htmlResponse(
        connectionsPageHtml({
          connections,
          email: identity.email,
          notice: "Google Account connected.",
          continueAction: Boolean(cookies.pending || transaction.mcpPending),
        }),
        200,
        headers,
      );
    }

    if (transaction.operation !== "bootstrap_operator") {
      throw new AppError("OAuth transaction is not valid for this callback.", "unauthorized", 401);
    }

    const existing = (await getAppStore().listConnectionsByGoogleSubject(identity.googleSubjectId))
      .filter((item) => item.status !== "disconnected");

    if (existing.length > 0) {
      const candidates: ResumeCandidate[] = [];
      for (const connection of existing) {
        const operator = await getAppStore().getOperator(connection.operatorId);
        if (!operator) {
          continue;
        }
        const count = (await getAppStore().listConnections(operator.operatorId)).length;
        candidates.push({
          operatorId: operator.operatorId,
          primaryEmail: operator.primaryEmail,
          googleEmail: connection.googleEmail,
          connectionCount: count,
          createdAt: operator.createdAt,
        });
      }
      const resumeNonce = randomBytes(16).toString("hex");
      await getAppStore().createTransaction({
        nonce: resumeNonce,
        operatorId: null,
        operation: "resume_choice",
        connectionId: null,
        mcpPending: transaction.mcpPending ?? cookies.pending ?? null,
        codeVerifier: null,
        googleState: null,
        exp: Date.now() + 15 * 60 * 1000,
        resumeCandidates: candidates,
        pendingGoogleSubjectId: identity.googleSubjectId,
        pendingGoogleEmail: identity.email,
        pendingGoogleDisplayName: identity.displayName,
        pendingRefreshTokenEncrypted: identity.refreshToken
          ? encryptRefreshToken(identity.refreshToken)
          : null,
        pendingGoogleScopes: identity.scopes,
      });
      const headers = new Headers();
      headers.append("Set-Cookie", resumeCookieHeader(resumeNonce, secure));
      return htmlResponse(
        resumePageHtml({
          googleEmail: identity.email,
          candidates,
        }),
        200,
        headers,
      );
    }

    const { operator, connection } = await createOperatorWithConnection(identity);
    const sessionId = createMcpSessionId();
    logger.info("Flow 1 operator bootstrap completed", {
      operatorId: operator.operatorId,
      connectionId: connection.connectionId,
    });
    const connections = await getAppStore().listConnections(operator.operatorId);
    const headers = new Headers();
    headers.append(
      "Set-Cookie",
      operatorCookieHeader({ operatorId: operator.operatorId, sessionId, secure }),
    );
    return htmlResponse(
      connectionsPageHtml({
        connections,
        email: identity.email,
        notice: "First Google Account connected. You can connect another or continue to Claude.",
        continueAction: true,
      }),
      200,
      headers,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google authorization failed.";
    logger.error("Google OAuth callback failed", {
      errorCategory: error instanceof AppError ? error.code : "google_oauth",
    });
    const headers = new Headers();
    appendCookies(headers, clearOAuthCookieHeaders(secure));
    return htmlResponse(
      pageHtml(
        "Google authorization failed",
        `<h1>Google authorization failed</h1><p class="error">${escapeHtml(message)}</p>`,
      ),
      error instanceof AppError ? toHttpStatus(error.status, 500) : 400,
      headers,
    );
  }
}
