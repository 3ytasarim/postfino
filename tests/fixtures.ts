// Synthetic media files with valid headers (enough for probing/validation; not playable).

export function jpeg(width: number, height: number): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(64, 0), Buffer.from([0xff, 0xd9])]);
}

export function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function box(type: string, ...children: Buffer[]): Buffer {
  const payload = Buffer.concat(children);
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + payload.length, 0);
  h.write(type, 4, "ascii");
  return Buffer.concat([h, payload]);
}
const u32 = (...n: number[]) => {
  const b = Buffer.alloc(n.length * 4);
  n.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4));
  return b;
};

export function mp4(o: { durationMs: number; width: number; height: number; videoCodec?: string; audioCodec?: string; fps?: number; mdatFirst?: boolean }): Buffer {
  const timescale = 1000;
  const fps = o.fps ?? 30;
  const mvhd = box("mvhd", Buffer.from([0, 0, 0, 0]), u32(0, 0, timescale, o.durationMs), Buffer.alloc(80));
  const tkhd = box("tkhd", Buffer.from([0, 0, 0, 3]), u32(0, 0, 1, 0, o.durationMs), Buffer.alloc(52), u32(o.width * 65536, o.height * 65536));
  const mediaTs = 15360;
  const sampleDelta = Math.round(mediaTs / fps);
  const samples = Math.round((o.durationMs / 1000) * fps);
  const mdhd = (ts: number) => box("mdhd", Buffer.from([0, 0, 0, 0]), u32(0, 0, ts, Math.round((o.durationMs / 1000) * ts)), Buffer.alloc(4));
  const hdlr = (h: string) => box("hdlr", Buffer.from([0, 0, 0, 0]), u32(0), Buffer.from(h, "ascii"), Buffer.alloc(13));
  const stsd = (codec: string) => box("stsd", Buffer.from([0, 0, 0, 0]), u32(1), box(codec, Buffer.alloc(78)));
  const stts = box("stts", Buffer.from([0, 0, 0, 0]), u32(1, samples, sampleDelta));
  const video = box("trak", tkhd, box("mdia", mdhd(mediaTs), hdlr("vide"), box("minf", box("stbl", stsd(o.videoCodec ?? "avc1"), stts))));
  const audio = box("trak", box("mdia", mdhd(48000), hdlr("soun"), box("minf", box("stbl", stsd(o.audioCodec ?? "mp4a")))));
  const moov = box("moov", mvhd, video, audio);
  const ftyp = box("ftyp", Buffer.from("isom", "ascii"), u32(512), Buffer.from("isomiso2avc1mp41", "ascii"));
  const mdat = box("mdat", Buffer.alloc(256, 7));
  return o.mdatFirst ? Buffer.concat([ftyp, mdat, moov]) : Buffer.concat([ftyp, moov, mdat]);
}
