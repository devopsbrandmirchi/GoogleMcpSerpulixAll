import { describe, expect, it, vi } from "vitest";
import { fetchGa4PropertyCreateTime, ga4CreateTimeToIso } from "@/products/ga4/api/admin";

describe("GA4 property creation time", () => {
  it("converts protobuf timestamp to UTC ISO", () => {
    expect(ga4CreateTimeToIso({ seconds: "1704067200", nanos: 123000000 })).toBe("2024-01-01T00:00:00.123Z");
  });
  it("accepts ISO strings and rejects invalid values", () => {
    expect(ga4CreateTimeToIso("2024-01-01T00:00:00Z")).toBe("2024-01-01T00:00:00.000Z");
    expect(ga4CreateTimeToIso("invalid")).toBeNull();
    expect(ga4CreateTimeToIso(null)).toBeNull();
  });
  it("requests the canonical property and reads its creation time", async () => {
    const getProperty = vi.fn().mockResolvedValue([{ createTime: { seconds: 1704067200, nanos: 0 } }]);
    const result = await fetchGa4PropertyCreateTime({ getProperty } as never, "12345");
    expect(getProperty).toHaveBeenCalledWith({ name: "properties/12345" });
    expect(result).toBe("2024-01-01T00:00:00.000Z");
  });
  it("propagates lookup errors for caller to isolate", async () => {
    const getProperty = vi.fn().mockRejectedValue(new Error("quota exceeded"));
    await expect(fetchGa4PropertyCreateTime({ getProperty } as never, "12345")).rejects.toThrow("quota exceeded");
  });
});
