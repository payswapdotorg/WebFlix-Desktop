// P6-PWA-1 — the install-icon generator (node:zlib only, zero deps).
//
// Generates the manifest's two static icons as HONEST placeholders: a
// solid WebFlix brand color (the host chrome's #0f1420 ground) with a
// 1px border tone. NO fetched assets, NO fonts, NO text rendering —
// simple solid PNGs, reproducible from this script:
//
//   node apps/web-client/scripts/generate-icons.mjs
//
// (run once; the emitted PNGs are committed as static assets under
// apps/web-client/public/ — the build copies them verbatim.)
import { deflateSync } from "node:zlib";
import { promises as fs } from "node:fs";
import path from "node:path";

const GROUND = [0x0f, 0x14, 0x20]; // the host chrome's dark ground
const BORDER = [0x2c, 0x3a, 0x58]; // the host chrome's border tone

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function solidPng(size, ground, border, borderInset = 8) {
  // RGBA scanlines with a simple inset border (the honest placeholder art).
  const stride = size * 4;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inset =
        x < borderInset || y < borderInset || x >= size - borderInset || y >= size - borderInset;
      const [r, g, b] = inset ? border : ground;
      const o = y * stride + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = new URL("../public/", import.meta.url).pathname;
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, "icon-192.png"), solidPng(192, GROUND, BORDER, 6));
await fs.writeFile(path.join(outDir, "icon-512.png"), solidPng(512, GROUND, BORDER, 16));
console.log("wrote public/icon-192.png + public/icon-512.png");
