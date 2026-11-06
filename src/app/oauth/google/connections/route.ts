import { connectionsPageHtml } from "@/oauth/pages";
import { AppError } from "@/lib/errors";
import { escapeHtml, htmlResponse, pageHtml } from "@/lib/html";
import {
  assertOperatorCookie,
  clearOAuthCookieHeaders,
  readOAuthCookies,
  requestIsHttps,
} from "@/lib/oauth-cookies";
import { mcpAuthorizeRedirectUrl } from "@/mcp/oauth/complete";
import { assertPendingMcpAuthorize } from "@/mcp/oauth/pending";
import { getAppStore } from "@/store/app-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const cookies = readOAuthCookies(req);
    const operatorCookie = assertOperatorCookie(cookies.operator);
    const connections = await getAppStore().listConnections(operatorCookie.operatorId);
    return htmlResponse(
      connectionsPageHtml({
        connections,
        continueAction: Boolean(cookies.pending),
      }),
    );
  } catch (error) {
    return htmlResponse(
      pageHtml(
        "Connections",
        `<h1>Connections</h1><p class="error">${escapeHtml(
          error instanceof Error ? error.message : "Unauthorized",
        )}</p>`,
      ),
      401,
    );
  }
}

export async function POST(req: Request) {
  const secure = requestIsHttps(req);
  try {
    const cookies = readOAuthCookies(req);
    const operatorCookie = assertOperatorCookie(cookies.operator);
    const pending = assertPendingMcpAuthorize(cookies.pending);
    const operator = await getAppStore().getOperator(operatorCookie.operatorId);
    if (!operator) {
      throw new AppError("The authenticated operator was not found.", "operator_not_found", 401);
    }
    const headers = new Headers({
      Location: mcpAuthorizeRedirectUrl(pending, operator.operatorId, operatorCookie.sessionId),
    });
    for (const cookie of clearOAuthCookieHeaders(secure)) {
      headers.append("Set-Cookie", cookie);
    }
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return htmlResponse(
      pageHtml(
        "Could not continue to Claude",
        `<h1>Could not continue to Claude</h1><p class="error">${escapeHtml(
          error instanceof Error ? error.message : "Unauthorized",
        )}</p>`,
      ),
      400,
    );
  }
}
