import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { hmacSha256Hex, safeEqual } from "./crypto";

// Object storage abstraction. Buckets are private; providers (Meta) receive short-lived signed URLs only.
// Phase 1: local filesystem driver + HMAC-signed URLs served by apps/api (`GET /media-files/...`).
// Production: S3-compatible Hetzner Object Storage driver with SigV4 presigned URLs.

export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Time-limited URL a third party can GET. Returns null if no public base is configured. */
  signedUrl(key: string, ttlSeconds: number): string | null;
}

export class LocalStorageDriver implements StorageDriver {
  constructor(
    private readonly root: string,
    private readonly signingSecret: string,
    private readonly publicBaseUrl: string | undefined,
  ) {}

  private file(key: string) {
    if (key.includes("..") || path.isAbsolute(key)) throw new Error("invalid storage key");
    return path.join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, data);
  }
  get(key: string) {
    return readFile(this.file(key));
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
  signedUrl(key: string, ttlSeconds: number) {
    if (!this.publicBaseUrl) return null;
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = hmacSha256Hex(this.signingSecret, `${key}:${exp}`);
    return `${this.publicBaseUrl.replace(/\/$/, "")}/media-files/${key.split("/").map(encodeURIComponent).join("/")}?exp=${exp}&sig=${sig}`;
  }
  verify(key: string, exp: number, sig: string, nowSec = Math.floor(Date.now() / 1000)) {
    return exp >= nowSec && safeEqual(hmacSha256Hex(this.signingSecret, `${key}:${exp}`), sig);
  }
}
