import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@/lib/errors";

export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_REDIRECTS = 3;

const UPLOAD_HINT =
  "Use ads_create_image_upload_link so the user can upload the file from their computer instead.";

export const IMAGE_REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
};

function fail(message: string): AppError {
  return new AppError(`${message} ${UPLOAD_HINT}`, "validation", 400);
}

function isPrivateIpv4(address: string): boolean {
  const [a = 0, b = 0] = address.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

export function isPrivateAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (isIP(lower) === 4) {
    return isPrivateIpv4(lower);
  }
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    return isPrivateIpv4(mapped[1]!);
  }
  return (
    lower === "::" || lower === "::1" ||
    lower.startsWith("fc") || lower.startsWith("fd") ||
    /^fe[89ab]/.test(lower) ||
    lower.startsWith("ff")
  );
}

function assertPublicUrlShape(url: URL): void {
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    isIP(host.replace(/^\[|\]$/g, "")) !== 0 ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    !host.includes(".")
  ) {
    throw new AppError("Image URLs must be public https URLs with a domain name.", "validation", 400);
  }
}

async function assertPublicHost(url: URL): Promise<void> {
  assertPublicUrlShape(url);
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw fail(`The image host ${url.hostname} could not be resolved.`);
  }
  if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) {
    throw fail(`The image URL points to a non-public address (${url.hostname}).`);
  }
}

async function readLimited(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw fail("The image is larger than 20 MB.");
  }
  if (!response.body) {
    return Buffer.alloc(0);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw fail("The image is larger than 20 MB.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function fetchImage(rawUrl: string): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("The image URL is not valid.", "validation", 400);
  }
  const signal = AbortSignal.timeout(15_000);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(url);
    let response: Response;
    try {
      response = await fetch(url, { redirect: "manual", headers: IMAGE_REQUEST_HEADERS, signal });
    } catch {
      throw fail(`The image could not be downloaded from ${url.hostname} (network error or timeout).`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw fail(`The website returned a ${response.status} redirect without a location.`);
      }
      url = new URL(location, url);
      continue;
    }
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      throw fail(`The website returned ${response.status}; it likely blocks automated downloads.`);
    }
    if (!response.ok) {
      throw fail(`The image download failed with status ${response.status}.`);
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (contentType === "text/html" || contentType === "application/xhtml+xml") {
      throw fail("This URL is a web page (text/html), not a direct image link. Open the image itself and copy its address.");
    }
    const bytes = await readLimited(response);
    if (bytes.length === 0) {
      throw fail("The image download was empty.");
    }
    return bytes;
  }

  throw fail(`The image URL redirected more than ${MAX_REDIRECTS} times.`);
}
