import { describe, expect, it } from "vitest";
import { normalizeCustomerId } from "@/lib/customer-id";

describe("normalizeCustomerId", () => {
  it("strips hyphens before Ads API use", () => {
    expect(normalizeCustomerId("123-456-7890")).toBe("1234567890");
    expect(normalizeCustomerId("1234567890")).toBe("1234567890");
    expect(normalizeCustomerId("customers/1234567890")).toBe("1234567890");
  });

  it("rejects invalid IDs", () => {
    expect(() => normalizeCustomerId("abc")).toThrow(/Invalid Google Ads customer ID/);
  });
});
