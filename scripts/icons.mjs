// scripts/icons.mjs — генерация иконок расширения.
//
// PNG собирается руками через zlib: тащить в проект графический пакет ради
// четырёх картинок не хочется, а Chrome иконки в SVG не принимает.
//
//   node scripts/icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'icons');

const BG = [22, 22, 26];       // --surface
const RING = [232, 230, 225];  // --text
const DOT = [125, 211, 160];   // --accent

const SS = 4; // суперсэмплинг: контур и точка иначе рвутся на 16px

/** Рисует линзу: круглый корпус, кольцо-оправа, зелёная точка состояния. */
function draw(size) {
  const px = new Uint8Array(size * size * 4);
  const c = size / 2;
  const rOuter = size * 0.46;
  const ringW = Math.max(size * 0.075, 1.1);
  const rDot = size * 0.145;
  const dotC = { x: size * 0.5, y: size * 0.5 };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0, 0];

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          const d = Math.hypot(fx - c, fy - c);
          const dd = Math.hypot(fx - dotC.x, fy - dotC.y);

          let col = null;
          if (dd <= rDot) col = DOT;
          else if (d <= rOuter && d >= rOuter - ringW) col = RING;
          else if (d <= rOuter) col = BG;

          if (col) { acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 255; }
        }
      }

      const n = SS * SS;
      const i = (y * size + x) * 4;
      const a = acc[3] / n;
      if (a > 0) {
        // премультиплицированное усреднение: цвет считаем только по покрытым сэмплам
        const cov = acc[3] / 255;
        px[i] = Math.round(acc[0] / cov);
        px[i + 1] = Math.round(acc[1] / cov);
        px[i + 2] = Math.round(acc[2] / cov);
        px[i + 3] = Math.round(a);
      }
    }
  }
  return px;
}

// ── PNG ──────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // бит на канал
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // фильтр None
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(OUT, `${size}.png`), png(size, draw(size)));
  console.log(`icons/${size}.png`);
}
