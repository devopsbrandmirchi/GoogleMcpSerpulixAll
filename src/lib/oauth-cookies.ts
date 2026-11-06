import { decryptCookiePayload, encryptCookiePayload } from "@/lib/crypto";
import type { PendingMcpAuthorize } from "@/mcp/oauth/pending";

export const STATE_COOKIE = "gconnect_oauth_state";
export const VERIFIER_COOKIE = "gconnect_oauth_verifier";
export const PENDING_COOKIE = "gconnect_mcp_pending";
export const OPERATOR_COOKIE = "gconnect_oauth_operator";
export const RESUME_COOKIE = "gconnect_oauth_resume";
const MAX_AGE_SECONDS = 15 * 60;

export interface PendingOperatorCookie {
  operatorId: string;
  sessionId: string;
  exp: number;
}

function cookieBase(secure: boolean, maxAge = MAX_AGE_SECONDS): string {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function expiredCookie(name: string, secure: boolean): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

function readCookieMap(req: Request): Record<string, string> {
  const cookie = req.headers.get("cookie");
  if (!cookie) {
    return {};
  }
  return Object.fromEntries(
    cookie.split(";").map((part) => {
      const [name, ...rest] = part.trim().split("=");
      return [name, decodeURIComponent(rest.join("="))];
    }),
  );
}

export function oauthCookieHeaders(params: {
  state: string;
  verifier: string;
  pending?: PendingMcpAuthorize | null;
  secure: boolean;
}): string[] {
  const base = cookieBase(params.secure);
  const cookies = [
    `${STATE_COOKIE}=${encodeURIComponent(params.state)}; ${base}`,
    `${VERIFIER_COOKIE}=${encodeURIComponent(params.verifier)}; ${base}`,
  ];
  if (params.pending) {
    cookies.push(
      `${PENDING_COOKIE}=${encodeURIComponent(encryptCookiePayload(params.pending))}; ${base}`,
    );
  }
  return cookies;
}

export function operatorCookieHeader(params: {
  operatorId: string;
  sessionId: string;
  secure: boolean;
}): string {
  const payload: PendingOperatorCookie = {
    operatorId: params.operatorId,
    sessionId: params.sessionId,
    exp: Date.now() + MAX_AGE_SECONDS * 1000,
  };
  return `${OPERATOR_COOKIE}=${encodeURIComponent(encryptCookiePayload(payload))}; ${cookieBase(params.secure)}`;
}

export function resumeCookieHeader(nonce: string, secure: boolean): string {
  return `${RESUME_COOKIE}=${encodeURIComponent(nonce)}; ${cookieBase(secure)}`;
}

export function clearOAuthCookieHeaders(secure: boolean): string[] {
  return [
    expiredCookie(STATE_COOKIE, secure),
    expiredCookie(VERIFIER_COOKIE, secure),
    expiredCookie(PENDING_COOKIE, secure),
    expiredCookie(OPERATOR_COOKIE, secure),
    expiredCookie(RESUME_COOKIE, secure),
  ];
}

export function readOAuthCookies(req: Request): {
  state?: string;
  verifier?: string;
  pending?: PendingMcpAuthorize;
  operator?: PendingOperatorCookie;
  resumeNonce?: string;
} {
  const values = readCookieMap(req);
  let pending: PendingMcpAuthorize | undefined;
  let operator: PendingOperatorCookie | undefined;

  if (values[PENDING_COOKIE]) {
    try {
      pending = decryptCookiePayload<PendingMcpAuthorize>(values[PENDING_COOKIE]);
    } catch {
      pending = undefined;
    }
  }
  if (values[OPERATOR_COOKIE]) {
    try {
      operator = decryptCookiePayload<PendingOperatorCookie>(values[OPERATOR_COOKIE]);
    } catch {
      operator = undefined;
    }
  }

  return {
    state: values[STATE_COOKIE],
    verifier: values[VERIFIER_COOKIE],
    pending,
    operator,
    resumeNonce: values[RESUME_COOKIE],
  };
}

export function requestIsHttps(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-proto");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() === "https";
  }
  return new URL(req.url).protocol === "https:";
}

export function assertOperatorCookie(
  operator: PendingOperatorCookie | undefined,
): PendingOperatorCookie {
  if (!operator?.operatorId || operator.exp < Date.now()) {
    throw new Error("The operator session expired. Start the connector again.");
  }
  return operator;
}
