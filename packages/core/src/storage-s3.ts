import { createHash, createHmac } from "node:crypto";
import type { StorageDriver } from "./storage";

// Minimal S3-compatible driver (Hetzner Object Storage, AWS, MinIO) with AWS Signature V4 — no SDK.
// Objects stay private; Meta and browsers only receive presigned GET URLs with a short TTL.

export type S3Options = {
  endpoint: string; // e.g. https://fsn1.your-objectstorage.com
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  addressing?: "path" | "virtual";
  fetch?: typeof fetch;
  now?: () => Date;
};

const sha256hex = (d: string | Uint8Array) => createHash("sha256").update(d).digest("hex");
const hmac = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d).digest();
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (p: string) => p.split("/").map(rfc3986).join("/");
const amzDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export class S3StorageDriver implements StorageDriver {
  private readonly http: typeof fetch;
  constructor(private readonly o: S3Options) {
    this.http = o.fetch ?? fetch;
  }

  private target(key: string) {
    const ep = new URL(this.o.endpoint);
    if ((this.o.addressing ?? "path") === "virtual") return { host: `${this.o.bucket}.${ep.host}`, path: `/${encodePath(key)}`, protocol: ep.protocol };
    return { host: ep.host, path: `/${rfc3986(this.o.bucket)}/${encodePath(key)}`, protocol: ep.protocol };
  }

  private signingKey(date: string) {
    return hmac(hmac(hmac(hmac(`AWS4${this.o.secretAccessKey}`, date), this.o.region), "s3"), "aws4_request");
  }

  /** Query-string presigned URL (SigV4). */
  presign(method: "GET" | "PUT", key: string, ttlSeconds: number, at = this.o.now?.() ?? new Date()): string {
    const { host, path, protocol } = this.target(key);
    const ts = amzDate(at);
    const date = ts.slice(0, 8);
    const scope = `${date}/${this.o.region}/s3/aws4_request`;
    const q: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.o.accessKeyId}/${scope}`,
      "X-Amz-Date": ts,
      "X-Amz-Expires": String(Math.min(ttlSeconds, 604800)),
      "X-Amz-SignedHeaders": "host",
    };
    const canonicalQuery = Object.keys(q)
      .sort()
      .map((k) => `${rfc3986(k)}=${rfc3986(q[k]!)}`)
      .join("&");
    const canonical = [method, path, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const toSign = ["AWS4-HMAC-SHA256", ts, scope, sha256hex(canonical)].join("\n");
    const sig = createHmac("sha256", this.signingKey(date)).update(toSign).digest("hex");
    return `${protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${sig}`;
  }

  private async request(method: "PUT" | "GET" | "DELETE", key: string, body?: Buffer, contentType?: string) {
    const { host, path, protocol } = this.target(key);
    const at = this.o.now?.() ?? new Date();
    const ts = amzDate(at);
    const date = ts.slice(0, 8);
    const payloadHash = sha256hex(body ?? "");
    const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": ts };
    if (contentType) headers["content-type"] = contentType;
    const names = Object.keys(headers).sort();
    const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]!.trim()}\n`).join(""), names.join(";"), payloadHash].join("\n");
    const scope = `${date}/${this.o.region}/s3/aws4_request`;
    const sig = createHmac("sha256", this.signingKey(date)).update(["AWS4-HMAC-SHA256", ts, scope, sha256hex(canonical)].join("\n")).digest("hex");
    const { host: _h, ...sendHeaders } = headers;
    void _h;
    const res = await this.http(`${protocol}//${host}${path}`, {
      method,
      headers: { ...sendHeaders, authorization: `AWS4-HMAC-SHA256 Credential=${this.o.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${sig}` },
      body: body ? new Uint8Array(body) : undefined,
    });
    if (!res.ok && !(method === "DELETE" && res.status === 404)) throw new Error(`S3 ${method} ${key} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  async put(key: string, data: Buffer, contentType: string) {
    await this.request("PUT", key, data, contentType);
  }
  async get(key: string) {
    return Buffer.from(await (await this.request("GET", key)).arrayBuffer());
  }
  async delete(key: string) {
    await this.request("DELETE", key);
  }
  signedUrl(key: string, ttlSeconds: number) {
    return this.presign("GET", key, ttlSeconds);
  }
}
