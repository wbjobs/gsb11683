// Generates 1000 PNG test images (varied sizes) + manifest.json using only Node's zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = new URL('../images/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePNG(width, height, pixelFn) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      const p = row + 1 + x * 4;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// deterministic pseudo-random
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
}

const SIZES = [
  [320, 240], [400, 300], [480, 360], [600, 450], [800, 600],
  [1024, 768], [1280, 960], [1600, 1200],
];
const manifest = [];
const CORRUPT = new Set([13, 377, 888]); // truncated files -> decode failure path

for (let i = 0; i < 1000; i++) {
  const rand = rng(i * 7919 + 17);
  // mostly small/medium, ~12% large, a few very large
  let sizeIdx = Math.floor(rand() * 5);
  if (rand() < 0.12) sizeIdx = 5 + Math.floor(rand() * 3);
  if (i % 199 === 0) sizeIdx = 7;
  const [w, h] = SIZES[sizeIdx];
  const hue = Math.floor(rand() * 360);
  const circles = Array.from({ length: 3 + Math.floor(rand() * 5) }, () => ({
    cx: rand() * w, cy: rand() * h, r: 20 + rand() * (w / 4),
    cr: Math.floor(rand() * 255), cg: Math.floor(rand() * 255), cb: Math.floor(rand() * 255),
  }));
  const px = (x, y) => {
    let r = Math.floor(127 + 127 * Math.sin((x / w) * 6 + hue));
    let g = Math.floor(127 + 127 * Math.sin((y / h) * 6 + hue * 2));
    let b = Math.floor((hue * 255 / 360 + (x + y) / (w + h) * 128) % 256);
    for (const c of circles) {
      const d = Math.hypot(x - c.cx, y - c.cy);
      if (d < c.r) { const t = 1 - d / c.r; r = r * (1 - t) + c.cr * t; g = g * (1 - t) + c.cg * t; b = b * (1 - t) + c.cb * t; }
    }
    return [r & 255, g & 255, b & 255, 255];
  };
  let png = encodePNG(w, h, px);
  if (CORRUPT.has(i)) png = png.subarray(0, Math.floor(png.length / 2)); // truncated
  const name = `img-${String(i).padStart(4, '0')}.png`;
  writeFileSync(join(OUT, name), png);
  manifest.push({ id: i, src: `images/${name}`, width: w, height: h, corrupt: CORRUPT.has(i) });
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest));
console.log('done', manifest.length, 'images');
