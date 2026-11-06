import { describe, expect, it } from "vitest";
import { assertReadOnlyGaql } from "@/products/google-ads/api/gaql";

describe("assertReadOnlyGaql", () => {
  it("allows SELECT queries", () => {
    expect(assertReadOnlyGaql("SELECT campaign.id FROM campaign")).toContain("SELECT");
  });

  it("rejects mutations", () => {
    expect(() => assertReadOnlyGaql("UPDATE campaign SET campaign.name = 'x'")).toThrow(/read-only/);
    expect(() => assertReadOnlyGaql("DELETE FROM campaign")).toThrow(/read-only/);
  });
});
