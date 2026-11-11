import { AppError, mapGoogleError, toHttpStatus } from "@/lib/errors";
import { escapeHtml, htmlResponse, pageHtml } from "@/lib/html";
import { logger } from "@/lib/logger";
import {
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILES,
  uploadImageAssets,
  type UploadFile,
} from "@/products/google-ads/api/upload-images";
import { readUploadToken } from "@/products/google-ads/upload-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errorPage(error: unknown): Response {
  const mapped = error instanceof AppError ? error : mapGoogleError(error, "ads");
  return htmlResponse(
    pageHtml(
      "Image upload failed",
      `<h1>Image upload failed</h1><p class="error">${escapeHtml(mapped.message)}</p>
      <p class="note">Go back to try again, or ask Claude for a new upload link.</p>`,
    ),
    toHttpStatus(mapped.status, 400),
  );
}

function formPage(token: string, customerId: string): string {
  return pageHtml(
    "Upload images to Google Ads",
    `<h1>Upload images to Google Ads</h1>
    <p>Images are added as assets to Google Ads customer <code>${escapeHtml(customerId)}</code>.</p>
    <form method="post" action="/ads/upload" enctype="multipart/form-data">
      <input type="hidden" name="t" value="${escapeHtml(token)}" />
      <label for="files">Choose up to ${MAX_UPLOAD_FILES} images (PNG, JPEG, GIF, WebP or AVIF, up to 10 MB each and 30 MB in total)</label>
      <input id="files" type="file" name="files" accept="image/*" multiple required />
      <button type="submit">Upload</button>
    </form>
    <p class="note">Display campaigns need a landscape 1.91:1 image (at least 600x314), a square 1:1 image (at least 300x300), and optionally a 1:1 or 4:1 logo. WebP and AVIF are converted automatically.</p>`,
  );
}

export async function GET(req: Request) {
  try {
    const token = new URL(req.url).searchParams.get("t") ?? "";
    const payload = readUploadToken(token);
    return htmlResponse(formPage(token, payload.customerId));
  } catch (error) {
    return errorPage(error);
  }
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const token = form.get("t");
    const payload = readUploadToken(typeof token === "string" ? token : "");
    const files: UploadFile[] = [];
    for (const entry of form.getAll("files")) {
      if (typeof entry === "string" || entry.size === 0) {
        continue;
      }
      if (entry.size > MAX_UPLOAD_FILE_BYTES) {
        throw new AppError(`${entry.name} is larger than 10 MB.`, "validation", 400);
      }
      files.push({ fileName: entry.name || "image", bytes: Buffer.from(await entry.arrayBuffer()) });
    }

    const uploaded = await uploadImageAssets(payload, files);
    logger.info("Uploaded Google Ads image assets", {
      operatorId: payload.operatorId,
      customerId: payload.customerId,
      count: uploaded.length,
    });

    const rows = uploaded
      .map((item) => `<li><strong>${escapeHtml(item.fileName)}</strong>: asset ID <code>${escapeHtml(
        item.assetId ?? "unknown",
      )}</code>, ${item.width}x${item.height}, ${escapeHtml(item.aspectHint)}${
        item.converted ? " (converted)" : ""
      }</li>`)
      .join("");
    return htmlResponse(pageHtml(
      "Images uploaded",
      `<h1>Images uploaded</h1>
      <p>These images are now assets in Google Ads customer <code>${escapeHtml(payload.customerId)}</code>.</p>
      <ul>${rows}</ul>
      <p class="note">Return to Claude and say the images are uploaded. Claude can find them with ads_list_image_assets.</p>`,
    ));
  } catch (error) {
    logger.warn("Google Ads image upload failed", {
      errorCategory: error instanceof AppError ? error.code : "unknown",
    });
    return errorPage(error);
  }
}
