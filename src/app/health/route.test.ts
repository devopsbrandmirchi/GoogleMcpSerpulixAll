import { describe, expect, it } from "vitest";
import { GET } from "@/app/health/route";

describe("health", () => {
  it("returns ok without secrets", async () => {
    const response = GET();
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("1.0.0");
    expect(JSON.stringify(body)).not.toMatch(/token|secret|key/i);
  });
});
