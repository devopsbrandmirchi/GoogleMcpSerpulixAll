import { describe, expect, it } from "vitest";
import { redactForLogs } from "@/lib/logger";

describe("logger redaction", () => {
  it("redacts tokens and developer token fields", () => {
    const redacted = redactForLogs({
      refresh_token: "1//secret",
      developer_token: "ABcdeFGH93KL-NOPQ_STUv",
      access_token: "ya29.abc",
      operatorId: "op-1",
    }) as Record<string, unknown>;
    expect(redacted.refresh_token).toBe("[REDACTED]");
    expect(redacted.developer_token).toBe("[REDACTED]");
    expect(redacted.access_token).toBe("[REDACTED]");
    expect(redacted.operatorId).toBe("op-1");
  });
});
