import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

// ── Envelope-free AES-256-GCM with key versions (rotation) ──
// ENCRYPTION_KEYS="v2:<base64 32 bytes>,v1:<base64>" → encrypt with v2, decrypt with any listed key.
// Ciphertext format: "<version>.<iv b64url>.<tag b64url>.<data b64url>"

export type Keyring = { current: string; keys: Map<string, Buffer> };

export function parseKeyring(spec: string | undefined, env: string): Keyring {
  if (!spec) {
    if (env === "production") throw new Error("ENCRYPTION_KEYS is required in production");
    // Deterministic dev/test key — never used in production (guarded above).
    return { current: "dev", keys: new Map([["dev", createHash("sha256").update("sichttakt-dev-only-key").digest()]]) };
  }
  const keys = new Map<string, Buffer>();
  let current = "";
  for (const part of spec.split(",").map((p) => p.trim()).filter(Boolean)) {
    const [version, b64] = part.split(":");
    const key = Buffer.from(b64 ?? "", "base64");
    if (!version || key.length !== 32) throw new Error(`invalid encryption key entry "${version}"`);
    keys.set(version, key);
    if (!current) current = version;
  }
  return { current, keys };
}

export function encrypt(ring: Keyring, plaintext: string): { value: string; version: string } {
  const key = ring.keys.get(ring.current)!;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return { value: [ring.current, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join("."), version: ring.current };
}

export function decrypt(ring: Keyring, value: string): string {
  const [version, iv, tag, data] = value.split(".");
  const key = version ? ring.keys.get(version) : undefined;
  if (!key || !iv || !tag || data === undefined) throw new Error("cannot decrypt: unknown key version or malformed value");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

// ── Hashing / tokens ──
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const hmacSha256Hex = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ── Passwords: scrypt (N=2^15, r=8, p=1) ──
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const got = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(got, expected);
}
