import sharp from "sharp";
import { AppError } from "@/lib/errors";

export const MAX_ASSET_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageMimeType = "image/png" | "image/jpeg" | "image/gif";

export interface NormalizedImage {
  data: Buffer;
  mimeType: ImageMimeType;
  width: number;
  height: number;
  aspectHint: string;
  converted: boolean;
}

const PASSTHROUGH: Record<string, ImageMimeType> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
};

const CONVERTIBLE = new Set(["webp", "heif", "avif", "tiff"]);

function near(value: number, target: number, tolerance: number): boolean {
  return Math.abs(value - target) / target <= tolerance;
}

export function aspectHint(width: number, height: number): string {
  const ratio = width / height;
  if (near(ratio, 1.91, 0.03)) {
    return width >= 600 && height >= 314
      ? "landscape 1.91:1 (Display marketing image)"
      : "landscape 1.91:1, but below the 600x314 minimum";
  }
  if (near(ratio, 1, 0.02)) {
    return width >= 300
      ? "square 1:1 (Display square image or logo)"
      : width >= 128
        ? "square 1:1 (logo size; below 300x300 for square marketing images)"
        : "square 1:1, but below the 128x128 logo minimum";
  }
  if (near(ratio, 4, 0.05)) {
    return "landscape 4:1 (Display logo)";
  }
  return `other (${ratio.toFixed(2)}:1); Display images need 1.91:1, 1:1 or a 4:1 logo`;
}

function decodeError(): AppError {
  return new AppError(
    "The file is not a supported image. Use PNG, JPEG, GIF, WebP or AVIF.",
    "validation",
    400,
  );
}

export async function normalizeImage(bytes: Buffer): Promise<NormalizedImage> {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    throw decodeError();
  }
  const format = metadata.format ?? "";
  const rotated = (metadata.orientation ?? 1) >= 5;
  const width = (rotated ? metadata.height : metadata.width) ?? 0;
  const height = (rotated ? metadata.width : metadata.height) ?? 0;
  if (!width || !height || format === "svg" || (!PASSTHROUGH[format] && !CONVERTIBLE.has(format))) {
    throw decodeError();
  }

  let data = bytes;
  let mimeType = PASSTHROUGH[format];
  let converted = false;
  if (!mimeType) {
    const image = sharp(bytes).rotate();
    if (metadata.hasAlpha) {
      data = await image.png().toBuffer();
      mimeType = "image/png";
    } else {
      data = await image.jpeg({ quality: 90 }).toBuffer();
      mimeType = "image/jpeg";
    }
    converted = true;
  }

  if (data.length > MAX_ASSET_IMAGE_BYTES && mimeType !== "image/gif") {
    data = await sharp(bytes).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();
    mimeType = "image/jpeg";
    converted = true;
  }
  if (data.length > MAX_ASSET_IMAGE_BYTES) {
    throw new AppError("The image is larger than 5 MB even after compression. Use a smaller image.", "validation", 400);
  }

  return { data, mimeType, width, height, aspectHint: aspectHint(width, height), converted };
}
