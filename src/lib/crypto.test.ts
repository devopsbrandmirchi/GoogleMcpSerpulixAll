import { beforeEach, describe, expect, it } from "vitest";
import { decryptRefreshToken, encryptRefreshToken } from "@/lib/crypto";
import { setRequiredEnv } from "@/test/env";

describe("refresh token encryption", () => {
  beforeEach(() => {
    setRequiredEnv();
  });

  it("round-trips a refresh token", () => {
    const encrypted = encryptRefreshToken("1//abc");
    expect(encrypted).not.toContain("1//abc");
    expect(decryptRefreshToken(encrypted)).toBe("1//abc");
  });
});
