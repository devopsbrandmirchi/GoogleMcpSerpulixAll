import { lookup } from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchImage, isPrivateAddress, MAX_DOWNLOAD_BYTES } from "./image-fetch";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

const PUBLIC = [{ address: "93.184.216.34", family: 4 }];

function image(status = 200, headers: Record<string, string> = { "content-type": "image/png" }, body: BodyInit = "img") {
  return new Response(status >= 300 && status < 400 ? null : body, { status, headers });
}

beforeEach(() => {
  vi.mocked(lookup).mockResolvedValue(PUBLIC as never);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("fetchImage", () => {
  it("sends browser headers and returns the bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(image());
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchImage("https://cdn.example.com/a.png")).toString()).toBe("img");
    const init = fetchMock.mock.calls[0]![1] as RequestInit & { headers: Record<string, string> };
    expect(init.redirect).toBe("manual");
    expect(init.headers["User-Agent"]).toContain("Mozilla/5.0");
    expect(init.headers.Accept).toContain("image/webp");
  });

  it("follows redirects and re-checks each hop", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(image(301, { location: "https://www.example.com/a.png" }))
      .mockResolvedValueOnce(image(302, { location: "/final.png" }))
      .mockResolvedValueOnce(image());
    vi.stubGlobal("fetch", fetchMock);
    await fetchImage("https://example.com/a.png");
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://example.com/a.png",
      "https://www.example.com/a.png",
      "https://www.example.com/final.png",
    ]);
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("blocks redirects to private addresses", async () => {
    vi.mocked(lookup)
      .mockResolvedValueOnce(PUBLIC as never)
      .mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }] as never);
    const fetchMock = vi.fn().mockResolvedValueOnce(image(302, { location: "https://intranet.example.com/x.png" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchImage("https://example.com/a.png")).rejects.toThrow("non-public address");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks redirects to http and too many redirects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(image(302, { location: "http://example.com/a.png" })));
    await expect(fetchImage("https://example.com/a.png")).rejects.toThrow("public https");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(image(302, { location: "https://example.com/loop.png" })));
    await expect(fetchImage("https://example.com/a.png")).rejects.toThrow("more than 3 times");
  });

  it.each([
    "https://localhost/a.png",
    "https://127.0.0.1/a.png",
    "https://[::1]/a.png",
    "https://metadata.google.internal/a.png",
  ])("refuses %s without fetching", async (url) => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(fetchImage(url)).rejects.toThrow("public https");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains blocked downloads and web pages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(image(403)));
    await expect(fetchImage("https://example.com/a.png")).rejects.toThrow(/403.*blocks automated downloads.*ads_create_image_upload_link/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(image(200, { "content-type": "text/html" }, "<html>")));
    await expect(fetchImage("https://example.com/page")).rejects.toThrow("web page");
  });

  it("enforces the 20 MB limit from headers and from the stream", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(image(200, {
      "content-type": "image/png", "content-length": String(MAX_DOWNLOAD_BYTES + 1),
    })));
    await expect(fetchImage("https://example.com/a.png")).rejects.toThrow("20 MB");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(image(200, { "content-type": "image/png" }, new Uint8Array(MAX_DOWNLOAD_BYTES + 1))));
    await expect(fetchImage("https://example.com/a.png")).rejects.toThrow("20 MB");
  });
});

describe("isPrivateAddress", () => {
  it.each(["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])(
    "flags %s",
    (address) => expect(isPrivateAddress(address)).toBe(true),
  );
  it.each(["93.184.216.34", "8.8.8.8", "2606:4700::1111"])("allows %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});
