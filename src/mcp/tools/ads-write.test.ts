import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGconnectMcpHandler } from "@/mcp/server";
import { issueAccessToken } from "@/mcp/oauth/tokens";
import { createMemoryAppStore } from "@/store/memory";
import { resetAppStore, setAppStore } from "@/store/app-store";
import { setRequiredEnv } from "@/test/env";

const WRITE_TOOLS = [
  "ads_mutate",
  "ads_create_campaign",
  "ads_create_demand_gen_campaign",
  "ads_create_asset",
  "ads_create_ad_group",
  "ads_add_keywords",
  "ads_create_responsive_search_ad",
  "ads_set_status",
  "ads_update_budget",
  "ads_set_targeting",
];

let token: string;

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const response = await createGconnectMcpHandler()(
    new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  return (await response.json()) as { result?: Record<string, unknown>; error?: unknown };
}

beforeEach(async () => {
  setRequiredEnv();
  vi.stubEnv("GOOGLE_ADS_WRITES_ENABLED", "true");
  vi.stubEnv("GOOGLE_ADS_WRITE_CUSTOMER_IDS", "*");
  vi.stubEnv("GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS", "10000000");
  const store = createMemoryAppStore();
  setAppStore(store);
  const operator = await store.createOperator("owner@example.com");
  token = issueAccessToken({ clientId: "test-client", sub: operator.operatorId });
});
afterEach(() => { vi.unstubAllEnvs(); resetAppStore(); });

describe("Google Ads write tools over MCP", () => {
  it("lists every write tool with a JSON schema and write annotations", async () => {
    const body = await rpc("tools/list");
    const tools = (body.result?.tools ?? []) as Array<{
      name: string;
      inputSchema: { type?: string; properties?: Record<string, unknown> };
      annotations?: { readOnlyHint?: boolean };
    }>;
    for (const name of WRITE_TOOLS) {
      const tool = tools.find((item) => item.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.inputSchema.type).toBe("object");
      expect(tool!.inputSchema.properties).toHaveProperty("customerId");
      expect(tool!.inputSchema.properties).toHaveProperty("validateOnly");
      expect(tool!.annotations?.readOnlyHint).toBe(false);
    }
  });

  it("lists the image upload link and image asset tools", async () => {
    const tools = (await rpc("tools/list")).result?.tools as Array<{
      name: string;
      annotations?: { readOnlyHint?: boolean };
    }>;
    expect(tools.find((tool) => tool.name === "ads_create_image_upload_link")?.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((tool) => tool.name === "ads_list_image_assets")?.annotations?.readOnlyHint).toBe(true);
  });

  it("hides DV360 tools unless DV360_ENABLED=true", async () => {
    const dv360Tools = async () => ((await rpc("tools/list")).result?.tools as Array<{ name: string }>)
      .filter((tool) => tool.name.startsWith("dv360_"))
      .map((tool) => tool.name);
    expect(await dv360Tools()).toEqual([]);
    vi.stubEnv("DV360_ENABLED", "true");
    expect(await dv360Tools()).toHaveLength(7);
  });

  it("rejects deleting a campaign before any Google call", async () => {
    const body = await rpc("tools/call", {
      name: "ads_mutate",
      arguments: {
        customerId: "1234567890",
        operations: [{ campaignOperation: { remove: "customers/1234567890/campaigns/1" } }],
      },
    });
    const result = body.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Pause it instead");
  });
});
