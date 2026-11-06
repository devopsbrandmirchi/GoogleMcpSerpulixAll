import { afterEach, describe, expect, it } from "vitest";
import { getConfig, resolveFirestoreDatabaseId } from "@/lib/config";
import { setRequiredEnv } from "@/test/env";

describe("firestore database id", () => {
  afterEach(() => {
    setRequiredEnv();
  });

  it("requires the dedicated named database and rejects foreign IDs", () => {
    expect(resolveFirestoreDatabaseId("google-mcp-serpulix-all")).toBe("google-mcp-serpulix-all");
    expect(() => resolveFirestoreDatabaseId("(default)")).toThrow(/named database/);
    expect(() => resolveFirestoreDatabaseId("default")).toThrow(/named database/);
    expect(() => resolveFirestoreDatabaseId("ga4-mcp-v3")).toThrow(/google-mcp-serpulix-all/);
    expect(() => resolveFirestoreDatabaseId("")).toThrow(/FIRESTORE_DATABASE_ID/);
    expect(() => resolveFirestoreDatabaseId("something-else")).toThrow(/google-mcp-serpulix-all/);
  });

  it("loads FIRESTORE_DATABASE_ID from env", () => {
    setRequiredEnv();
    expect(getConfig().firestoreDatabaseId).toBe("google-mcp-serpulix-all");
  });
});
