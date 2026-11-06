const SECRET_KEYS = [
  "access_token",
  "refresh_token",
  "id_token",
  "authorization",
  "authorization_code",
  "code",
  "code_verifier",
  "client_secret",
  "mcp_auth_token",
  "mcp_token_secret",
  "oauth_state_secret",
  "token_encryption_key",
  "developer_token",
  "developertoken",
  "google_ads_developer_token",
  "cookie",
  "cookies",
  "encryptedrefreshtoken",
  "encrypted_refresh_token",
  "pendingrefreshtokenencrypted",
  "refreshtokenencrypted",
] as const;

const SECRET_PATTERNS = [
  /ya29\.[a-zA-Z0-9._~-]+/g,
  /1\/\/[a-zA-Z0-9._~-]+/g,
  /4\/[0-9A-Za-z._~-]+/g,
];

function redactString(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

function redactUnknown(value: unknown, key?: string): unknown {
  if (key && SECRET_KEYS.includes(key.toLowerCase() as (typeof SECRET_KEYS)[number])) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      result[entryKey] = redactUnknown(entryValue, entryKey);
    }
    return result;
  }
  return value;
}

export function redactForLogs(value: unknown): unknown {
  return redactUnknown(value);
}

function write(severity: "INFO" | "WARNING" | "ERROR", message: string, extra?: unknown): void {
  const payload: Record<string, unknown> = {
    severity,
    message,
  };
  if (extra !== undefined) {
    const redacted = redactUnknown(extra);
    if (redacted && typeof redacted === "object" && !Array.isArray(redacted)) {
      Object.assign(payload, redacted);
    } else {
      payload.extra = redacted;
    }
  }

  const line = JSON.stringify(payload);
  if (severity === "ERROR") {
    console.error(line);
    return;
  }
  if (severity === "WARNING") {
    console.warn(line);
    return;
  }
  console.info(line);
}

export const logger = {
  info(message: string, extra?: unknown): void {
    write("INFO", message, extra);
  },
  warn(message: string, extra?: unknown): void {
    write("WARNING", message, extra);
  },
  error(message: string, extra?: unknown): void {
    write("ERROR", message, extra);
  },
};
