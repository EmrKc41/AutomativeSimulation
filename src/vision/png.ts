import { deflateSync } from "node:zlib";

/**
 * A minimal PNG encoder.
 *
 * Written by hand rather than pulled in as a dependency: the dataset generator
 * needs exactly one thing — 8-bit RGB, no interlacing, no palette — and a
 * native canvas binding would add a compile step to a project that otherwise
 * installs clean on Windows.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** An RGB canvas you can draw into before encoding. */
export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 3);
  }

  set(x: number, y: number, r: number, g: number, b: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const index = (y * this.width + x) * 3;
    this.pixels[index] = clampByte(r);
    this.pixels[index + 1] = clampByte(g);
    this.pixels[index + 2] = clampByte(b);
  }

  get(x: number, y: number): [number, number, number] {
    const cx = Math.max(0, Math.min(this.width - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(this.height - 1, Math.round(y)));
    const index = (cy * this.width + cx) * 3;
    return [this.pixels[index] ?? 0, this.pixels[index + 1] ?? 0, this.pixels[index + 2] ?? 0];
  }

  /** Blend a colour over the pixel; `alpha` is 0..1. */
  blend(x: number, y: number, r: number, g: number, b: number, alpha: number): void {
    if (alpha <= 0) return;
    const [pr, pg, pb] = this.get(x, y);
    const a = Math.min(1, alpha);
    this.set(x, y, pr + (r - pr) * a, pg + (g - pg) * a, pb + (b - pb) * a);
  }

  /** Multiply the pixel's brightness — how a dent or a shadow reads. */
  shade(x: number, y: number, factor: number): void {
    const [r, g, b] = this.get(x, y);
    this.set(x, y, r * factor, g * factor, b * factor);
  }
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function encodePng(canvas: Canvas): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(canvas.width, 0);
  header.writeUInt32BE(canvas.height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // colour type: truecolour RGB
  header.writeUInt8(0, 10); // deflate
  header.writeUInt8(0, 11); // no filtering beyond the per-scanline byte
  header.writeUInt8(0, 12); // no interlace

  const stride = canvas.width * 3;
  const raw = Buffer.alloc((stride + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    Buffer.from(canvas.pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
