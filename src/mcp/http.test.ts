import { describe, expect, it } from "vitest";
import { extractMcpToken, parseSseJsonPayload } from "@/mcp/http";

describe("mcp http helpers", () => {
  it("extracts bearer tokens", () => {
    const req = new Request("http://localhost/mcp", {
      headers: { Authorization: "Bearer abc.def" },
    });
    expect(extractMcpToken(req)).toBe("abc.def");
  });

  it("parses SSE JSON payloads", () => {
    expect(parseSseJsonPayload('data: {"ok":true}\n\n')).toBe('{"ok":true}');
  });
});
