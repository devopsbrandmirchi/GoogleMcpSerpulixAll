import { bindGoogleIdentityToOperator, createOperatorWithConnection } from "@/oauth/bind-connection";
import { connectionsPageHtml } from "@/oauth/pages";
import { AppError } from "@/lib/errors";
import { escapeHtml, htmlResponse, pageHtml } from "@/lib/html";
import { logger } from "@/lib/logger";
import {
  operatorCookieHeader,
  readOAuthCookies,
  requestIsHttps,
  RESUME_COOKIE,
} from "@/lib/oauth-cookies";
import { createMcpSessionId } from "@/mcp/oauth/tokens";
import { getAppStore } from "@/store/app-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secure = requestIsHttps(req);
  try {
    const form = await req.formData();
    const choice = String(form.get("choice") ?? "");
    const requestedOperatorId = String(form.get("operatorId") ?? "");
    const cookies = readOAuthCookies(req);
    const nonce = cookies.resumeNonce;
    if (!nonce) {
      throw new AppError("The resume session expired.", "session_invalid", 400);
    }
    const transaction = await getAppStore().consumeTransaction(nonce);
    if (transaction.operation !== "resume_choice") {
      throw new AppError("OAuth transaction is not valid for resume.", "unauthorized", 401);
    }
    if (!transaction.pendingGoogleSubjectId) {
      throw new AppError("The Google identity for this resume session is missing.", "session_invalid", 400);
    }

    const identity = {
      googleSubjectId: transaction.pendingGoogleSubjectId,
      email: transaction.pendingGoogleEmail ?? null,
      displayName: transaction.pendingGoogleDisplayName ?? null,
      refreshToken: null,
      scopes: transaction.pendingGoogleScopes ?? [],
    };

    let operatorId: string;
    if (choice === "start_new") {
      const created = await createOperatorWithConnection(
        identity,
        transaction.pendingRefreshTokenEncrypted,
      );
      operatorId = created.operator.operatorId;
      logger.info("Resume choice created new operator", { operatorId });
    } else if (choice === "resume") {
      const allowed = new Set(
        (transaction.resumeCandidates ?? []).map((candidate) => candidate.operatorId),
      );
      if (!requestedOperatorId || !allowed.has(requestedOperatorId)) {
        throw new AppError("Choose one of the listed workspaces.", "validation", 400);
      }
      const bound = await bindGoogleIdentityToOperator({
        operatorId: requestedOperatorId,
        identity,
        encryptedRefreshToken: transaction.pendingRefreshTokenEncrypted,
      });
      operatorId = bound.operator.operatorId;
      logger.info("Resume choice bound existing operator", { operatorId });
    } else {
      throw new AppError("Choose Resume or Start new.", "validation", 400);
    }

    const sessionId = createMcpSessionId();
    const connections = await getAppStore().listConnections(operatorId);
    const headers = new Headers();
    headers.append("Set-Cookie", operatorCookieHeader({ operatorId, sessionId, secure }));
    headers.append(
      "Set-Cookie",
      `${RESUME_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
    );
    return htmlResponse(
      connectionsPageHtml({
        connections,
        email: identity.email,
        notice:
          choice === "start_new"
            ? "New workspace created. Existing Google connections were not merged."
            : "Existing workspace resumed. Other operators' connections were left unchanged.",
        continueAction: Boolean(transaction.mcpPending || cookies.pending),
      }),
      200,
      headers,
    );
  } catch (error) {
    return htmlResponse(
      pageHtml(
        "Resume failed",
        `<h1>Resume failed</h1><p class="error">${escapeHtml(
          error instanceof Error ? error.message : "Resume failed",
        )}</p>`,
      ),
      400,
    );
  }
}
