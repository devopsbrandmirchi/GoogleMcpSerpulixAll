import { describe, expect, it } from "vitest";
import { getOperatorContext, runWithOperator } from "@/lib/request-context";

describe("request context", () => {
  it("isolates operator identity per async context", async () => {
    const first = runWithOperator({ requestId: "r1", operatorId: "op-a" }, () => getOperatorContext().operatorId);
    const second = runWithOperator({ requestId: "r2", operatorId: "op-b" }, () => getOperatorContext().operatorId);
    expect(first).toBe("op-a");
    expect(second).toBe("op-b");
  });
});
