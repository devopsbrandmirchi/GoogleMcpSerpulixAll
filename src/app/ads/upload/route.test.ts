import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { executeGuardedMutate } from "@/products/google-ads/api/mutate";
import { peekOperatorContext } from "@/lib/request-context";
import { signJwt } from "@/mcp/oauth/jwt";
import { issueUploadToken, readUploadToken, uploadUrl } from "@/products/google-ads/upload-token";
import { setRequiredEnv } from "@/test/env";

vi.mock("@/products/google-ads/api/mutate", () => ({ executeGuardedMutate: vi.fn() }));

const C = "1234567890";
let token: string;

async function png(width = 600, height = 314) {
  return sharp({ create: { width, height, channels: 3, background: "#00aa55" } }).png().toBuffer();
}

function postForm(files: Array<{ name: string; bytes: Buffer; type?: string }>, t = token) {
  const form = new FormData();
  form.set("t", t);
  for (const file of files) {
    form.append("files", new File([new Uint8Array(file.bytes)], file.name, { type: file.type ?? "image/png" }));
  }
  return POST(new Request("http://localhost:3000/ads/upload", { method: "POST", body: form }));
}

beforeEach(() => {
  setRequiredEnv();
  token = issueUploadToken({ operatorId: "op-1", sessionId: "sess-1", customerId: C, connectionId: "conn-1" });
  vi.mocked(executeGuardedMutate).mockImplementation(async (params) => ({
    customerId: C,
    googleAccount: "a@example.com",
    validated: false,
    executed: true,
    operations: [],
    result: {
      mutateOperationResponses: params.operations.map((_op, index) => ({
        assetResult: { resourceName: `customers/${C}/assets/${1000 + index}` },
      })),
    },
    requestId: "req",
    note: "",
  }));
});
afterEach(() => { vi.clearAllMocks(); });

describe("upload token", () => {
  it("round-trips and builds the upload URL", () => {
    expect(readUploadToken(token)).toMatchObject({ typ: "ads_upload", operatorId: "op-1", customerId: C });
    expect(uploadUrl(token)).toBe(`http://localhost:3000/ads/upload?t=${encodeURIComponent(token)}`);
  });

  it("rejects tampered, expired and wrong-type tokens", () => {
    expect(() => readUploadToken(`${token}x`)).toThrow("invalid or has expired");
    const expired = signJwt({ typ: "ads_upload", operatorId: "op-1", customerId: C, exp: 1 });
    expect(() => readUploadToken(expired)).toThrow("invalid or has expired");
    const access = signJwt({ typ: "access", sub: "op-1", exp: Math.floor(Date.now() / 1000) + 60 });
    expect(() => readUploadToken(access)).toThrow("invalid or has expired");
  });
});

describe("/ads/upload", () => {
  it("renders the upload form for a valid link", async () => {
    const response = await GET(new Request(`http://localhost:3000/ads/upload?t=${encodeURIComponent(token)}`));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('type="file"');
    expect(html).toContain(C);
  });

  it("rejects an invalid link", async () => {
    const response = await GET(new Request("http://localhost:3000/ads/upload?t=bad"));
    expect(response.status).toBe(401);
  });

  it("creates image assets with confirmation inside the operator context", async () => {
    let context: ReturnType<typeof peekOperatorContext>;
    vi.mocked(executeGuardedMutate).mockImplementationOnce(async (params) => {
      context = peekOperatorContext();
      return {
        customerId: C, googleAccount: null, validated: false, executed: true, operations: [],
        result: { mutateOperationResponses: params.operations.map((_op, index) => ({
          assetResult: { resourceName: `customers/${C}/assets/${500 + index}` },
        })) },
        requestId: "req", note: "",
      };
    });
    const response = await postForm([
      { name: "banner.png", bytes: await png() },
      { name: "square.png", bytes: await png(300, 300) },
    ]);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("500");
    expect(html).toContain("501");
    expect(html).toContain("1.91:1");
    const params = vi.mocked(executeGuardedMutate).mock.calls[0]![0];
    expect(params).toMatchObject({ customerId: C, connectionId: "conn-1", validateOnly: false, confirm: true });
    expect(params.operations).toHaveLength(2);
    expect(params.operations[0]).toMatchObject({ assetOperation: { create: { type: "IMAGE", resourceName: `customers/${C}/assets/-1` } } });
    expect(context).toMatchObject({ operatorId: "op-1", sessionId: "sess-1" });
  });

  it("rejects too many files, oversized files and non-images", async () => {
    const small = await png(10, 10);
    const tooMany = await postForm(Array.from({ length: 6 }, (_, i) => ({ name: `${i}.png`, bytes: small })));
    expect(tooMany.status).toBe(400);
    expect(await tooMany.text()).toContain("at most 5");

    const big = await postForm([{ name: "big.png", bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }]);
    expect(big.status).toBe(400);
    expect(await big.text()).toContain("larger than 10 MB");

    const text = await postForm([{ name: "notes.txt", bytes: Buffer.from("hello"), type: "text/plain" }]);
    expect(text.status).toBe(400);
    expect(await text.text()).toContain("not a supported image");
    expect(executeGuardedMutate).not.toHaveBeenCalled();
  });

  it("rejects a POST with an invalid token", async () => {
    const response = await postForm([{ name: "a.png", bytes: await png() }], "bad");
    expect(response.status).toBe(401);
    expect(executeGuardedMutate).not.toHaveBeenCalled();
  });
});
