// Dependency-free media probing (first-pass validation before any provider call).
// On the server FFprobe/FFmpeg normalization is an additional step (docs/ARCHITECTURE.md §Media);
// this parser lets us reject obviously invalid files even where ffprobe is not installed.

export type ImageProbe = { kind: "image"; mimeType: "image/jpeg" | "image/png" | "image/webp"; width: number; height: number; progressive?: boolean };
export type VideoProbe = {
  kind: "video";
  mimeType: "video/mp4" | "video/quicktime";
  durationMs: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  frameRate?: number;
  moovBeforeMdat: boolean;
  hasEditList: boolean;
};
export type Probe = ImageProbe | VideoProbe | { kind: "unknown"; reason: string };

export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    return buf.toString("ascii", 8, 10) === "qt" ? "video/quicktime" : "video/mp4";
  }
  if (buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

export function probe(buf: Buffer): Probe {
  const mime = sniffMime(buf);
  if (mime === "image/jpeg") return probeJpeg(buf);
  if (mime === "image/png") return { kind: "image", mimeType: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (mime === "video/mp4" || mime === "video/quicktime") return probeMp4(buf, mime);
  return { kind: "unknown", reason: mime ? `unsupported type ${mime}` : "unrecognized file signature" };
}

function probeJpeg(buf: Buffer): Probe {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return { kind: "unknown", reason: "corrupt JPEG marker" };
    const marker = buf[i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { kind: "image", mimeType: "image/jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), progressive: marker === 0xc2 };
    }
    i += 2 + len;
  }
  return { kind: "unknown", reason: "JPEG without SOF segment" };
}

type Box = { type: string; start: number; size: number; header: number };

function readBoxes(buf: Buffer, start: number, end: number): Box[] {
  const out: Box[] = [];
  let i = start;
  while (i + 8 <= end) {
    let size = buf.readUInt32BE(i);
    const type = buf.toString("ascii", i + 4, i + 8);
    let header = 8;
    if (size === 1) {
      if (i + 16 > end) break;
      size = Number(buf.readBigUInt64BE(i + 8));
      header = 16;
    } else if (size === 0) size = end - i;
    if (size < header) break;
    out.push({ type, start: i, size, header });
    i += size;
  }
  return out;
}

const child = (buf: Buffer, box: Box, type: string, skip = 0) =>
  readBoxes(buf, box.start + box.header + skip, Math.min(box.start + box.size, buf.length)).find((b) => b.type === type);

function probeMp4(buf: Buffer, mimeType: "video/mp4" | "video/quicktime"): Probe {
  const top = readBoxes(buf, 0, buf.length);
  const moov = top.find((b) => b.type === "moov");
  const mdatIdx = top.findIndex((b) => b.type === "mdat");
  const moovIdx = top.findIndex((b) => b.type === "moov");
  if (!moov) return { kind: "unknown", reason: "MP4 without moov box (truncated upload?)" };
  const result: VideoProbe = { kind: "video", mimeType, durationMs: 0, moovBeforeMdat: mdatIdx === -1 || moovIdx < mdatIdx, hasEditList: false };

  const mvhd = child(buf, moov, "mvhd");
  if (mvhd) {
    const p = mvhd.start + mvhd.header;
    const version = buf[p]!;
    const timescale = version === 1 ? buf.readUInt32BE(p + 20) : buf.readUInt32BE(p + 12);
    const duration = version === 1 ? Number(buf.readBigUInt64BE(p + 24)) : buf.readUInt32BE(p + 16);
    if (timescale > 0) result.durationMs = Math.round((duration / timescale) * 1000);
  }

  for (const trak of readBoxes(buf, moov.start + moov.header, moov.start + moov.size).filter((b) => b.type === "trak")) {
    if (child(buf, trak, "edts")) result.hasEditList = true;
    const mdia = child(buf, trak, "mdia");
    if (!mdia) continue;
    const hdlr = child(buf, mdia, "hdlr");
    const handler = hdlr ? buf.toString("ascii", hdlr.start + hdlr.header + 8, hdlr.start + hdlr.header + 12) : "";
    const mdhd = child(buf, mdia, "mdhd");
    let timescale = 0;
    if (mdhd) {
      const p = mdhd.start + mdhd.header;
      timescale = buf[p] === 1 ? buf.readUInt32BE(p + 20) : buf.readUInt32BE(p + 12);
    }
    const stbl = (() => {
      const minf = child(buf, mdia, "minf");
      return minf ? child(buf, minf, "stbl") : undefined;
    })();
    const stsd = stbl ? child(buf, stbl, "stsd") : undefined;
    const codec = stsd ? buf.toString("ascii", stsd.start + stsd.header + 12, stsd.start + stsd.header + 16) : undefined;

    if (handler === "vide") {
      result.videoCodec = codec;
      const tkhd = child(buf, trak, "tkhd");
      if (tkhd) {
        const p = tkhd.start + tkhd.header;
        const off = buf[p] === 1 ? 88 : 76;
        result.width = buf.readUInt32BE(p + off) / 65536;
        result.height = buf.readUInt32BE(p + off + 4) / 65536;
      }
      const stts = stbl ? child(buf, stbl, "stts") : undefined;
      if (stts && timescale) {
        const p = stts.start + stts.header;
        const entries = buf.readUInt32BE(p + 4);
        let samples = 0;
        let ticks = 0;
        for (let e = 0; e < entries; e++) {
          const cnt = buf.readUInt32BE(p + 8 + e * 8);
          const delta = buf.readUInt32BE(p + 12 + e * 8);
          samples += cnt;
          ticks += cnt * delta;
        }
        if (ticks > 0) result.frameRate = Math.round((samples / (ticks / timescale)) * 100) / 100;
      }
    } else if (handler === "soun") {
      result.audioCodec = codec;
    }
  }
  return result;
}
