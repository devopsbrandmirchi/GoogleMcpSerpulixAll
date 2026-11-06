import { beforeEach, describe, expect, it } from "vitest";
import { authorizationServerMetadata, MCP_SCOPE, protectedResourceMetadata } from "@/mcp/oauth/metadata";
import { issueAccessToken, readAccessToken } from "@/mcp/oauth/tokens";
import { setRequiredEnv } from "@/test/env";

describe("MCP OAuth metadata and JWT identity", () => {
  beforeEach(() => {
    setRequiredEnv();
  });

  it("advertises Claude-compatible authorization server metadata", () => {
    const metadata = authorizationServerMetadata();
    expect(metadata.authorization_endpoint).toContain("/oauth/mcp/authorize");
    expect(metadata.token_endpoint).toContain("/oauth/mcp/token");
    expect(metadata.registration_endpoint).toContain("/oauth/mcp/register");
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.client_id_metadata_document_supported).toBe(true);
    expect(metadata.scopes_supported).toContain(MCP_SCOPE);
  });

  it("sets JWT sub to operatorId, never a Google subject", () => {
    const token = issueAccessToken({ clientId: "client", sub: "operator-123" });
    const payload = readAccessToken(token);
    expect(payload.sub).toBe("operator-123");
    expect(payload.typ).toBe("access");
    expect(protectedResourceMetadata().resource).toBe("http://localhost:3000/mcp");
  });
});
