import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { aspectHint, normalizeImage } from "./images";

function solid(width: number, height: number, channels: 3 | 4 = 3) {
  return sharp({
    create: { width, height, channels, background: channels === 4 ? { r: 0, g: 0, b: 0, alpha: 0.5 } : "#ff8800" },
  });
}

describe("normalizeImage", () => {
  it("keeps PNG and JPEG unchanged", async () => {
    const png = await solid(300, 300).png().toBuffer();
    const result = await normalizeImage(png);
    expect(result).toMatchObject({ mimeType: "image/png", width: 300, height: 300, converted: false });
    expect(result.data.equals(png)).toBe(true);
    expect((await normalizeImage(await solid(600, 314).jpeg().toBuffer())).mimeType).toBe("image/jpeg");
  });

  it("converts opaque WebP to JPEG", async () => {
    const result = await normalizeImage(await solid(600, 314).webp().toBuffer());
    expect(result).toMatchObject({ mimeType: "image/jpeg", width: 600, height: 314, converted: true });
    expect((await sharp(result.data).metadata()).format).toBe("jpeg");
    expect(result.aspectHint).toContain("1.91:1");
  });

  it("converts transparent WebP to PNG", async () => {
    const result = await normalizeImage(await solid(128, 128, 4).webp().toBuffer());
    expect(result).toMatchObject({ mimeType: "image/png", converted: true });
    expect((await sharp(result.data).metadata()).format).toBe("png");
  });

  it("converts AVIF", async () => {
    const result = await normalizeImage(await solid(400, 100).avif().toBuffer());
    expect(result.converted).toBe(true);
    expect(["image/jpeg", "image/png"]).toContain(result.mimeType);
    expect(result.aspectHint).toContain("4:1");
  });

  it("rejects non-images and SVG", async () => {
    await expect(normalizeImage(Buffer.from("<html>not an image</html>"))).rejects.toThrow("not a supported image");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
    await expect(normalizeImage(svg)).rejects.toThrow("not a supported image");
  });
});

describe("aspectHint", () => {
  it.each([
    [1200, 628, "1.91:1 (Display marketing image)"],
    [300, 157, "below the 600x314 minimum"],
    [1200, 1200, "square 1:1 (Display square image"],
    [200, 200, "logo size"],
    [1200, 300, "4:1"],
    [1000, 700, "other"],
  ])("labels %ix%i", (width, height, expected) => {
    expect(aspectHint(width, height)).toContain(expected);
  });
});
