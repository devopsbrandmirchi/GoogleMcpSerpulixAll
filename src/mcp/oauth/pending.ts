export interface PendingMcpAuthorize {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  state: string | null;
  exp: number;
}

export function isPendingMcpAuthorize(value: unknown): value is PendingMcpAuthorize {
  if (!value || typeof value !== "object") {
    return false;
  }
  const pending = value as PendingMcpAuthorize;
  return (
    typeof pending.clientId === "string" &&
    typeof pending.redirectUri === "string" &&
    typeof pending.codeChallenge === "string" &&
    typeof pending.scope === "string" &&
    typeof pending.exp === "number" &&
    (pending.state === null || typeof pending.state === "string")
  );
}

export function assertPendingMcpAuthorize(
  pending: PendingMcpAuthorize | undefined,
): PendingMcpAuthorize {
  if (!pending || !isPendingMcpAuthorize(pending) || pending.exp < Date.now()) {
    throw new Error("The Claude authorization session expired. Start the connector again.");
  }
  return pending;
}
