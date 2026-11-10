import { z } from "zod";
import { AppError } from "@/lib/errors";
import type { MutateOperation } from "@/products/google-ads/api/write-policy";
import { resourceName, writeBaseShape } from "@/products/google-ads/api/builders/common";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);

export const youtubeVideoIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{11}$/, "Use the 11-character YouTube video ID, for example dQw4w9WgXcQ.");

export const createAssetSchema = z.object({
  ...writeBaseShape,
  asset: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("TEXT"),
      text: z.string().trim().min(1).max(500),
      name: z.string().trim().min(1).max(128).optional(),
    }),
    z.object({
      type: z.literal("YOUTUBE_VIDEO"),
      youtubeVideoId: youtubeVideoIdSchema,
      name: z.string().trim().min(1).max(128).optional(),
    }),
    z.object({
      type: z.literal("IMAGE"),
      imageUrl: z.url({ protocol: /^https$/ }),
      name: z.string().trim().min(1).max(128),
    }),
  ]),
});

export type CreateAssetInput = z.output<typeof createAssetSchema>;

function assertPublicHost(url: URL): void {
  const host = url.hostname.toLowerCase();
  const isIpLiteral = /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[");
  if (
    url.protocol !== "https:" ||
    isIpLiteral ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    !host.includes(".")
  ) {
    throw new AppError("Image URLs must be public https URLs with a domain name.", "validation", 400);
  }
}

export async function fetchImageAsBase64(rawUrl: string): Promise<string> {
  const url = new URL(rawUrl);
  assertPublicHost(url);
  let response: Response;
  try {
    response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AppError("The image could not be downloaded. Use a direct https link without redirects.", "validation", 400);
  }
  if (!response.ok) {
    throw new AppError(`The image download failed with status ${response.status}.`, "validation", 400);
  }
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!IMAGE_CONTENT_TYPES.has(contentType)) {
    throw new AppError("Images must be PNG, JPEG or GIF.", "validation", 400);
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_IMAGE_BYTES) {
    throw new AppError("Images must be 5 MB or smaller.", "validation", 400);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new AppError("Images must be between 1 byte and 5 MB.", "validation", 400);
  }
  return bytes.toString("base64");
}

export async function buildAsset(customerId: string, input: CreateAssetInput): Promise<MutateOperation[]> {
  const base = { resourceName: resourceName(customerId, "assets", -1) };
  const { asset } = input;
  if (asset.type === "TEXT") {
    return [{ assetOperation: { create: { ...base, name: asset.name, textAsset: { text: asset.text } } } }];
  }
  if (asset.type === "YOUTUBE_VIDEO") {
    return [{ assetOperation: { create: {
      ...base,
      name: asset.name,
      youtubeVideoAsset: { youtubeVideoId: asset.youtubeVideoId },
    } } }];
  }
  return [{ assetOperation: { create: {
    ...base,
    name: asset.name,
    type: "IMAGE",
    imageAsset: { data: await fetchImageAsBase64(asset.imageUrl) },
  } } }];
}
