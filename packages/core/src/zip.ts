import { deflateRawSync, inflateRawSync } from "node:zlib";

// Minimal ZIP reader (central directory; stored + deflate). Guards: path traversal, entry count,
// total uncompressed size and compression ratio (zip bombs). ZIP64 and encryption are rejected.

export type ZipLimits = { maxEntries: number; maxTotalBytes: number; maxRatio: number };
export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 500, maxTotalBytes: 1.5 * 1024 ** 3, maxRatio: 200 };

export class ZipError extends Error {}

export function readZip(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new ZipError("ZIP64 not supported");
  if (count > limits.maxEntries) throw new ZipError(`too many entries (${count} > ${limits.maxEntries})`);
  const out = new Map<string, Buffer>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError("corrupt central directory");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen).replace(/\\/g, "/");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (name.startsWith("/") || /^[a-zA-Z]:/.test(name) || name.split("/").includes("..")) throw new ZipError(`unsafe path: ${name}`);
    if (name.startsWith("__MACOSX/") || name.split("/").pop()!.startsWith(".")) continue;
    if (flags & 0x1) throw new ZipError("encrypted entries are not supported");
    total += usize;
    if (total > limits.maxTotalBytes) throw new ZipError("archive too large when extracted");
    if (csize > 0 && usize / csize > limits.maxRatio) throw new ZipError(`suspicious compression ratio in ${name}`);
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new ZipError("corrupt local header");
    const start = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: usize + 1 });
    else throw new ZipError(`unsupported compression method ${method} (${name})`);
    if (data.length !== usize) throw new ZipError(`size mismatch in ${name}`);
    out.set(name, data);
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Minimal writer (stored or deflate) — used by tests and for downloadable templates. */
export function writeZip(files: Record<string, Buffer>, opts: { deflate?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nb = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const body = opts.deflate ? deflateRawSync(data) : data;
    const method = opts.deflate ? 8 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x800, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nb.length, 26);
    locals.push(lh, nb, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nb.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nb);
    offset += 30 + nb.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
