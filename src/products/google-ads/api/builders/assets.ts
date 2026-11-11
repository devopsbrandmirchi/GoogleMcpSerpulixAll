import { z } from "zod";
import type { MutateOperation } from "@/products/google-ads/api/write-policy";
import { resourceName, writeBaseShape } from "@/products/google-ads/api/builders/common";
import { fetchImage } from "@/products/google-ads/api/image-fetch";
import { normalizeImage } from "@/products/google-ads/api/images";

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
      imageUrl: z.url({ protocol: /^https?$/ }),
      name: z.string().trim().min(1).max(128),
    }),
  ]),
});

export type CreateAssetInput = z.output<typeof createAssetSchema>;

export function imageAssetOperation(customerId: string, tempId: number, name: string, data: Buffer): MutateOperation {
  return { assetOperation: { create: {
    resourceName: resourceName(customerId, "assets", tempId),
    name,
    type: "IMAGE",
    imageAsset: { data: data.toString("base64") },
  } } };
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
  const image = await normalizeImage(await fetchImage(asset.imageUrl.replace(/^http:/i, "https:")));
  return [imageAssetOperation(customerId, -1, asset.name, image.data)];
}
