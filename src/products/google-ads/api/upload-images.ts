import { randomBytes } from "node:crypto";
import { AppError } from "@/lib/errors";
import { createRequestId, runWithOperator } from "@/lib/request-context";
import { imageAssetOperation } from "@/products/google-ads/api/builders/assets";
import { normalizeImage, type NormalizedImage } from "@/products/google-ads/api/images";
import { executeGuardedMutate } from "@/products/google-ads/api/mutate";
import type { UploadTokenPayload } from "@/products/google-ads/upload-token";

export const MAX_UPLOAD_FILES = 5;
export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;

export interface UploadFile {
  fileName: string;
  bytes: Buffer;
}

export interface UploadedImage {
  fileName: string;
  assetName: string;
  assetId: string | null;
  resourceName: string | null;
  width: number;
  height: number;
  aspectHint: string;
  converted: boolean;
}

function assetName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[^\w .-]+/g, " ").trim().slice(0, 80) || "image";
  return `${base} ${randomBytes(3).toString("hex")}`;
}

function createdResourceNames(body: unknown): Array<string | null> {
  const responses = (body as { mutateOperationResponses?: unknown[] } | null)?.mutateOperationResponses ?? [];
  return responses.map((item) => {
    const name = (item as { assetResult?: { resourceName?: unknown } }).assetResult?.resourceName;
    return typeof name === "string" ? name : null;
  });
}

export async function uploadImageAssets(token: UploadTokenPayload, files: UploadFile[]): Promise<UploadedImage[]> {
  if (files.length === 0) {
    throw new AppError("Choose at least one image.", "validation", 400);
  }
  if (files.length > MAX_UPLOAD_FILES) {
    throw new AppError(`Upload at most ${MAX_UPLOAD_FILES} images at a time.`, "validation", 400);
  }
  for (const file of files) {
    if (file.bytes.length > MAX_UPLOAD_FILE_BYTES) {
      throw new AppError(`${file.fileName} is larger than 10 MB.`, "validation", 400);
    }
  }

  const prepared: Array<{ file: UploadFile; image: NormalizedImage; name: string }> = [];
  for (const file of files) {
    try {
      prepared.push({ file, image: await normalizeImage(file.bytes), name: assetName(file.fileName) });
    } catch (error) {
      throw new AppError(
        `${file.fileName}: ${error instanceof Error ? error.message : "could not be read"}`,
        "validation",
        400,
      );
    }
  }

  const outcome = await runWithOperator(
    { requestId: createRequestId(), operatorId: token.operatorId, sessionId: token.sessionId },
    () => executeGuardedMutate({
      customerId: token.customerId,
      connectionId: token.connectionId,
      operations: prepared.map((item, index) =>
        imageAssetOperation(token.customerId, -(index + 1), item.name, item.image.data)),
      validateOnly: false,
      confirm: true,
    }),
  );

  const names = createdResourceNames(outcome.result);
  return prepared.map((item, index) => {
    const resourceName = names[index] ?? null;
    return {
      fileName: item.file.fileName,
      assetName: item.name,
      assetId: resourceName?.split("/").pop() ?? null,
      resourceName,
      width: item.image.width,
      height: item.image.height,
      aspectHint: item.image.aspectHint,
      converted: item.image.converted,
    };
  });
}
