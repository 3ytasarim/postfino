// Minimal PDF 1.4 writer: A4 pages, Helvetica/Helvetica-Bold (WinAnsiEncoding → German umlauts, ß, €),
// text, filled rectangles, lines and one optional JPEG image (DCTDecode). No external dependencies.

const W = 595.28;
const H = 841.89;

const WIN_ANSI_EXTRA: Record<string, number> = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "–": 0x96, "—": 0x97, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "™": 0x99 };
const FALLBACK: Record<string, string> = { ş: "s", Ş: "S", ğ: "g", Ğ: "G", ı: "i", İ: "I", č: "c", ć: "c", ł: "l", ő: "o", ű: "u" };

/** Encodes text to WinAnsi bytes as a PDF literal string; unsupported characters become close ASCII or "?". */
export function pdfString(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    let code = WIN_ANSI_EXTRA[ch] ?? ch.codePointAt(0)!;
    if (code > 255 || (code >= 0x80 && code < 0xa0 && !Object.values(WIN_ANSI_EXTRA).includes(code))) {
      const f = FALLBACK[ch];
      if (f) code = f.charCodeAt(0);
      else if (/\p{Extended_Pictographic}/u.test(ch)) continue;
      else code = 63;
    }
    const c = String.fromCharCode(code);
    out += c === "(" || c === ")" || c === "\\" ? `\\${c}` : code < 32 ? " " : c;
  }
  return `(${out})`;
}

/** Rough Helvetica width estimate (enough for wrapping / truncation). */
export const textWidth = (text: string, size: number, bold = false) =>
  [...text].reduce((w, ch) => w + (/[il.,:;|!'’ ]/.test(ch) ? 0.28 : /[mwMW@]/.test(ch) ? 0.85 : /[A-ZÄÖÜ]/.test(ch) ? 0.68 : 0.55), 0) * size * (bold ? 1.05 : 1);

export function wrap(text: string, size: number, maxWidth: number, bold = false): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, bold) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

type Rgb = [number, number, number];
export class PdfDoc {
  private pages: string[][] = [[]];
  private image: { data: Buffer; width: number; height: number } | null = null;
  readonly width = W;
  readonly height = H;

  setImage(jpeg: Buffer, width: number, height: number) {
    this.image = { data: jpeg, width, height };
  }
  private get ops() {
    return this.pages.at(-1)!;
  }
  addPage() {
    this.pages.push([]);
  }
  text(x: number, y: number, text: string, o: { size?: number; bold?: boolean; color?: Rgb } = {}) {
    const [r, g, b] = o.color ?? [0.07, 0.08, 0.09];
    this.ops.push(`BT ${r} ${g} ${b} rg /${o.bold ? "F2" : "F1"} ${o.size ?? 10} Tf ${x.toFixed(2)} ${(H - y).toFixed(2)} Td ${pdfString(text)} Tj ET`);
  }
  rect(x: number, y: number, w: number, h: number, color: Rgb) {
    this.ops.push(`${color.join(" ")} rg ${x.toFixed(2)} ${(H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }
  line(x1: number, y1: number, x2: number, y2: number, color: Rgb = [0.85, 0.84, 0.8], width = 0.6) {
    this.ops.push(`${color.join(" ")} RG ${width} w ${x1.toFixed(2)} ${(H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(H - y2).toFixed(2)} l S`);
  }
  drawImage(x: number, y: number, w: number, h: number) {
    if (this.image) this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(H - y - h).toFixed(2)} cm /Im1 Do Q`);
  }

  toBuffer(meta: { title: string; author?: string }): Buffer {
    const objs: (string | Buffer)[] = [];
    const add = (o: string | Buffer) => objs.push(o) - 0;
    // 1 catalog, 2 pages, 3 F1, 4 F2, [5 image], then page/content pairs
    add("<< /Type /Catalog /Pages 2 0 R >>");
    add(""); // pages placeholder
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    let imgRef = "";
    if (this.image) {
      const n = objs.length + 1;
      objs.push(
        Buffer.concat([
          Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${this.image.width} /Height ${this.image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${this.image.data.length} >>\nstream\n`, "latin1"),
          this.image.data,
          Buffer.from("\nendstream", "latin1"),
        ]),
      );
      imgRef = ` /XObject << /Im1 ${n} 0 R >>`;
    }
    const kids: number[] = [];
    for (const ops of this.pages) {
      const content = Buffer.from(ops.join("\n"), "latin1");
      const contentNo = objs.length + 1;
      objs.push(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "latin1"), content, Buffer.from("\nendstream", "latin1")]));
      const pageNo = objs.length + 1;
      objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${imgRef} >> /Contents ${contentNo} 0 R >>`);
      kids.push(pageNo);
    }
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    const infoNo = objs.length + 1;
    objs.push(`<< /Title ${pdfString(meta.title)} /Author ${pdfString(meta.author ?? "Postfino")} /Producer (Postfino) >>`);

    const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
    const offsets: number[] = [];
    let pos = parts[0]!.length;
    objs.forEach((o, i) => {
      const body = typeof o === "string" ? Buffer.from(o, "latin1") : o;
      const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
      offsets.push(pos);
      pos += chunk.length;
      parts.push(chunk);
    });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
    parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${infoNo} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, "latin1"));
    return Buffer.concat(parts);
  }
}
