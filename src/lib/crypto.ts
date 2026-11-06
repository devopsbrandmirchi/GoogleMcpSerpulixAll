import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getConfig } from "@/lib/config";

const AUTH_TAG_LENGTH = 16;
const IV_LENGTH = 12;

export function encryptionKeyFromSecret(secret: string): Buffer {
  const trimmed = secret.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  return createHash("sha256").update(trimmed).digest();
}

function keyForPurpose(secret: string, purpose: string): Buffer {
  return createHash("sha256")
    .update(Buffer.concat([encryptionKeyFromSecret(secret), Buffer.from(`:${purpose}`)]))
    .digest();
}

export function encryptString(plaintext: string, secret: string, purpose: string): string {
  const key = keyForPurpose(secret, purpose);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptString(payload: string, secret: string, purpose: string): string {
  const raw = Buffer.from(payload, "base64url");
  if (raw.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted payload is invalid.");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const key = keyForPurpose(secret, purpose);
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function encryptJson(value: unknown, secret: string, purpose: string): string {
  return encryptString(JSON.stringify(value), secret, purpose);
}

export function decryptJson<T>(payload: string, secret: string, purpose: string): T {
  return JSON.parse(decryptString(payload, secret, purpose)) as T;
}

export function encryptRefreshToken(refreshToken: string): string {
  return encryptString(refreshToken, getConfig().tokenEncryptionKey, "refresh-token");
}

export function decryptRefreshToken(encryptedRefreshToken: string): string {
  return decryptString(encryptedRefreshToken, getConfig().tokenEncryptionKey, "refresh-token");
}

export function encryptCookiePayload(value: unknown): string {
  return encryptJson(value, getConfig().oauthStateSecret, "oauth-cookie");
}

export function decryptCookiePayload<T>(payload: string): T {
  return decryptJson<T>(payload, getConfig().oauthStateSecret, "oauth-cookie");
}
