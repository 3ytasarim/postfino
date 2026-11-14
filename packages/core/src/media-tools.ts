import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";

// Optional server-side media tooling. When not configured the result says so explicitly
// (`not_configured`) — a skipped scan is never reported as clean.

export type ScanResult = { status: "clean" | "infected" | "error" | "not_configured"; signature?: string; error?: string };

/** ClamAV clamd INSTREAM protocol (TCP). */
export function clamavScan(data: Buffer, host: string | undefined, port = 3310, timeoutMs = 30_000): Promise<ScanResult> {
  if (!host) return Promise.resolve({ status: "not_configured" });
  return new Promise((resolve) => {
    const sock = createConnection({ host, port });
    let reply = "";
    const done = (r: ScanResult) => {
      sock.destroy();
      resolve(r);
    };
    sock.setTimeout(timeoutMs, () => done({ status: "error", error: "timeout" }));
    sock.on("error", (e) => done({ status: "error", error: e.message }));
    sock.on("data", (d) => (reply += d.toString("utf8")));
    sock.on("end", () => {
      const r = reply.replace(/\0/g, "").trim();
      if (/OK$/.test(r)) done({ status: "clean" });
      else if (/FOUND$/.test(r)) done({ status: "infected", signature: r.replace(/^stream:\s*/, "").replace(/\s*FOUND$/, "") });
      else done({ status: "error", error: r || "empty reply" });
    });
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      const CHUNK = 64 * 1024;
      for (let i = 0; i < data.length; i += CHUNK) {
        const part = data.subarray(i, i + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        sock.write(len);
        sock.write(part);
      }
      sock.write(Buffer.alloc(4)); // zero-length chunk terminates the stream
    });
  });
}

export type FfprobeResult =
  | { status: "ok"; durationMs?: number; width?: number; height?: number; videoCodec?: string; audioCodec?: string; frameRate?: number; pixFmt?: string; raw: unknown }
  | { status: "not_configured" }
  | { status: "error"; error: string };

/** Runs ffprobe on a temp copy. Codec names are mapped to MP4 fourcc-style names used by the validators. */
export async function ffprobe(data: Buffer, ffprobePath: string | undefined, ext = "mp4"): Promise<FfprobeResult> {
  if (!ffprobePath) return { status: "not_configured" };
  const dir = await mkdtemp(path.join(os.tmpdir(), "st-probe-"));
  const file = path.join(dir, `in.${ext.replace(/[^a-z0-9]/gi, "")}`);
  try {
    await writeFile(file, data);
    const out = await new Promise<string>((res, rej) =>
      execFile(ffprobePath, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
        err ? rej(err) : res(stdout),
      ),
    );
    const j = JSON.parse(out) as { streams: Record<string, string | number>[]; format: { duration?: string } };
    const v = j.streams.find((s) => s.codec_type === "video");
    const a = j.streams.find((s) => s.codec_type === "audio");
    const codecMap: Record<string, string> = { h264: "avc1", hevc: "hvc1", aac: "mp4a", vp9: "vp09", av1: "av01" };
    const [num, den] = String(v?.avg_frame_rate ?? "0/1").split("/").map(Number);
    return {
      status: "ok",
      durationMs: j.format.duration ? Math.round(Number(j.format.duration) * 1000) : undefined,
      width: v ? Number(v.width) : undefined,
      height: v ? Number(v.height) : undefined,
      videoCodec: v ? (codecMap[String(v.codec_name)] ?? String(v.codec_name)) : undefined,
      audioCodec: a ? (codecMap[String(a.codec_name)] ?? String(a.codec_name)) : undefined,
      frameRate: den ? Math.round((num! / den) * 100) / 100 : undefined,
      pixFmt: v ? String(v.pix_fmt) : undefined,
      raw: j,
    };
  } catch (e) {
    return { status: "error", error: (e as Error).message.slice(0, 300) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
