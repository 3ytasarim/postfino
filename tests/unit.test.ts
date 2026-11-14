import { describe, expect, it } from "vitest";
import { wallClockToUtc, utcToWallClock, NonexistentLocalTimeError } from "@sichttakt/shared";
import { parseKeyring, encrypt, decrypt, hashPassword, verifyPassword, totpCode, verifyTotp, generateTotpSecret, probe, backoffMs, signPayload, verifySignature, isPrivateAddress } from "@sichttakt/core";
import { validateInstagram, InstagramAdapter } from "@sichttakt/social-adapters";
import { jpeg, png, mp4 } from "./fixtures";

describe("timezone / DST (Europe/Berlin)", () => {
  const tz = "Europe/Berlin";
  it("converts winter time (UTC+1)", () => {
    expect(wallClockToUtc({ year: 2026, month: 11, day: 12, hour: 10, minute: 0 }, tz).toISOString()).toBe("2026-11-12T09:00:00.000Z");
  });
  it("converts summer time (UTC+2)", () => {
    expect(wallClockToUtc({ year: 2026, month: 7, day: 1, hour: 10, minute: 0 }, tz).toISOString()).toBe("2026-07-01T08:00:00.000Z");
  });
  it("rejects non-existent local time in spring-forward gap", () => {
    expect(() => wallClockToUtc({ year: 2027, month: 3, day: 28, hour: 2, minute: 30 }, tz)).toThrow(NonexistentLocalTimeError);
  });
  it("resolves ambiguous fall-back time deterministically", () => {
    const wall = { year: 2026, month: 10, day: 25, hour: 2, minute: 30 };
    expect(wallClockToUtc(wall, tz, "earlier").toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(wallClockToUtc(wall, tz, "later").toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });
  it("weekly 09:00 slot stays 09:00 local across the DST change", () => {
    const before = wallClockToUtc({ year: 2026, month: 10, day: 24, hour: 9, minute: 0 }, tz);
    const after = wallClockToUtc({ year: 2026, month: 10, day: 31, hour: 9, minute: 0 }, tz);
    expect(utcToWallClock(before, tz).hour).toBe(9);
    expect(utcToWallClock(after, tz).hour).toBe(9);
    expect(after.getTime() - before.getTime()).toBe(7 * 864e5 + 3600_000);
  });
});

describe("crypto", () => {
  it("encrypts with current key and decrypts after rotation", () => {
    const k1 = Buffer.alloc(32, 1).toString("base64");
    const k2 = Buffer.alloc(32, 2).toString("base64");
    const old = parseKeyring(`v1:${k1}`, "production");
    const token = encrypt(old, "EAAG-secret-token");
    const rotated = parseKeyring(`v2:${k2},v1:${k1}`, "production");
    expect(decrypt(rotated, token.value)).toBe("EAAG-secret-token");
    expect(encrypt(rotated, "x").version).toBe("v2");
  });
  it("refuses missing keys in production", () => {
    expect(() => parseKeyring(undefined, "production")).toThrow();
  });
  it("hashes and verifies passwords", async () => {
    const h = await hashPassword("Sicher-Passwort-123");
    expect(await verifyPassword("Sicher-Passwort-123", h)).toBe(true);
    expect(await verifyPassword("falsch", h)).toBe(false);
  });
  it("TOTP matches RFC 6238 test vector", () => {
    // RFC 6238 SHA1 secret "12345678901234567890" → base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ, T=59s → 94287082 (8 digits) → last 6: 287082
    expect(totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000)).toBe("287082");
    const s = generateTotpSecret();
    expect(verifyTotp(s, totpCode(s))).toBe(true);
    expect(verifyTotp(s, "000000", 0)).toBe(totpCode(s, 0) === "000000");
  });
});

describe("media probe", () => {
  it("reads JPEG and PNG dimensions", () => {
    expect(probe(jpeg(1080, 1920))).toMatchObject({ kind: "image", mimeType: "image/jpeg", width: 1080, height: 1920 });
    expect(probe(png(640, 480))).toMatchObject({ kind: "image", mimeType: "image/png", width: 640, height: 480 });
  });
  it("reads MP4 duration, size, codecs, fps, faststart", () => {
    const p = probe(mp4({ durationMs: 12_500, width: 1080, height: 1920 }));
    expect(p).toMatchObject({ kind: "video", durationMs: 12_500, width: 1080, height: 1920, videoCodec: "avc1", audioCodec: "mp4a", moovBeforeMdat: true });
    expect((p as { frameRate: number }).frameRate).toBeCloseTo(30, 0);
    expect(probe(mp4({ durationMs: 5000, width: 720, height: 1280, mdatFirst: true }))).toMatchObject({ moovBeforeMdat: false });
  });
  it("rejects unknown signatures", () => {
    expect(probe(Buffer.from("not a media file"))).toMatchObject({ kind: "unknown" });
  });
});

describe("instagram reels validation (pre-API)", () => {
  const video = { assetId: "v", kind: "video" as const, mimeType: "video/mp4", sizeBytes: 10_000_000, width: 1080, height: 1920, durationMs: 15_000, videoCodec: "avc1", audioCodec: "mp4a", frameRate: 30 };
  const cover = { assetId: "c", kind: "image" as const, mimeType: "image/jpeg", sizeBytes: 300_000, width: 1080, height: 1920 };
  const base = { type: "reel" as const, caption: "Hallo", media: [], options: {} };
  it("accepts a valid reel + independent cover", () => {
    expect(validateInstagram({ ...base, video, cover })).toEqual([]);
  });
  it("rejects too short video, wrong codec, PNG cover, oversize cover", () => {
    const codes = validateInstagram({ ...base, video: { ...video, durationMs: 2000, videoCodec: "vp09" }, cover: { ...cover, mimeType: "image/png", sizeBytes: 9 * 1024 * 1024 } }).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["video_duration", "video_codec", "cover_format", "cover_too_large"]));
  });
  it("rejects the same file used as video and cover", () => {
    expect(validateInstagram({ ...base, video, cover: { ...cover, assetId: "v" } }).map((i) => i.code)).toContain("cover_same_as_video");
  });
  it("warns (non-blocking) on non 9:16 cover", () => {
    expect(validateInstagram({ ...base, video, cover: { ...cover, width: 1080, height: 1080 } }).map((i) => i.code)).toEqual(["cover_ratio_warning"]);
  });
});

describe("instagram adapter contract (mocked HTTP, no network)", () => {
  const calls: { url: string; method: string; body?: string }[] = [];
  const responses: Record<string, unknown>[] = [];
  const fakeFetch = (async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body?.toString() });
    const r = responses.shift() ?? {};
    const status = (r.__status as number) ?? 200;
    return new Response(JSON.stringify(r), { status });
  }) as typeof fetch;
  const adapter = new InstagramAdapter({ appId: "app", appSecret: "sec", graphVersion: "v27.0", fetch: fakeFetch });
  const auth = { accessToken: "SECRET-TOKEN-XYZ", externalId: "17841400000000000", meta: {} };
  const input = {
    type: "reel" as const,
    caption: "Unser neuer Cocktail ist da!",
    media: [],
    video: { assetId: "v", kind: "video" as const, mimeType: "video/mp4", sizeBytes: 1, publicUrl: "https://cdn.example/v.mp4" },
    cover: { assetId: "c", kind: "image" as const, mimeType: "image/jpeg", sizeBytes: 1, publicUrl: "https://cdn.example/c.jpg" },
    thumbOffsetMs: 1500,
    options: { shareToFeed: true },
  };

  it("sends media_type=REELS with cover_url and omits thumb_offset when a cover is set", async () => {
    responses.push({ id: "container-1" });
    const r = await adapter.createMedia(auth, input, () => {});
    expect(r.containerId).toBe("container-1");
    const body = new URLSearchParams(calls.at(-1)!.body);
    expect(calls.at(-1)!.url).toBe("https://graph.facebook.com/v27.0/17841400000000000/media");
    expect(body.get("media_type")).toBe("REELS");
    expect(body.get("cover_url")).toBe("https://cdn.example/c.jpg");
    expect(body.get("video_url")).toBe("https://cdn.example/v.mp4");
    expect(body.has("thumb_offset")).toBe(false);
  });
  it("uses thumb_offset when no independent cover", () => {
    const p = adapter.buildContainerParams({ ...input, cover: undefined });
    expect(p.thumb_offset).toBe("1500");
    expect(p.cover_url).toBeUndefined();
  });
  it("maps container status codes", async () => {
    responses.push({ status_code: "IN_PROGRESS" }, { status_code: "FINISHED" }, { status_code: "ERROR" });
    expect(await adapter.getPublishStatus(auth, "c", () => {})).toBe("in_progress");
    expect(await adapter.getPublishStatus(auth, "c", () => {})).toBe("ready");
    expect(await adapter.getPublishStatus(auth, "c", () => {})).toBe("error");
  });
  it("classifies Meta rate-limit errors as retryable and permission errors as final; redacts tokens in logs", async () => {
    const logs: unknown[] = [];
    responses.push({ __status: 400, error: { message: "Application request limit reached", code: 4 } });
    await expect(adapter.publish(auth, "c", (l) => logs.push(l))).rejects.toMatchObject({ retryable: true, providerCode: "META_4" });
    responses.push({ __status: 403, error: { message: "Permissions error", code: 10 } });
    await expect(adapter.publish(auth, "c", () => {})).rejects.toMatchObject({ retryable: false });
    expect(JSON.stringify(logs)).not.toContain("SECRET-TOKEN-XYZ");
  });
  it("builds a Facebook Login dialog URL with state", () => {
    const u = new URL(adapter.buildAuthUrl({ state: "st", redirectUri: "https://api.example/oauth/callback" }));
    expect(u.hostname).toBe("www.facebook.com");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("scope")).toContain("instagram_content_publish");
  });
});

describe("queue backoff, webhook signatures, SSRF guard", () => {
  it("backoff grows exponentially with jitter and caps", () => {
    expect(backoffMs(1, 1000, 60_000, () => 0)).toBe(500);
    expect(backoffMs(3, 1000, 60_000, () => 1)).toBe(4000);
    expect(backoffMs(20, 1000, 60_000, () => 1)).toBe(60_000);
  });
  it("verifies HMAC signatures and rejects tampering and replays", () => {
    const body = JSON.stringify({ id: "evt_1", type: "post.published" });
    const now = 1_800_000_000;
    const sig = signPayload("whsec_test", body, now);
    expect(verifySignature("whsec_test", body, sig, now)).toBe(true);
    expect(verifySignature("whsec_test", body + " ", sig, now)).toBe(false);
    expect(verifySignature("whsec_other", body, sig, now)).toBe(false);
    expect(verifySignature("whsec_test", body, sig, now + 301)).toBe(false);
  });
  it("detects private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.10", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "157.240.0.35", "2a03:2880::1"]) expect(isPrivateAddress(ip)).toBe(false);
  });
});
