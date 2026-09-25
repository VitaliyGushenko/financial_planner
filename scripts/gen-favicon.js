// Генератор src/favicon.ico: PNG-иконки 16/32/48 в ICO-обёртке.
// Рисует фирменный значок: зелёный скруглённый квадрат + столбики диаграммы.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---------- PNG ----------
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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

function png(size, pixelFn) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  const SS = 3; // суперсэмплинг 3x3 для сглаживания краёв
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [pr, pg, pb, pa] = pixelFn(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
        }
      }
      const n = SS * SS;
      const off = y * (1 + size * 4) + 1 + x * 4;
      if (a > 0) {
        raw[off] = Math.round(r / a);
        raw[off + 1] = Math.round(g / a);
        raw[off + 2] = Math.round(b / a);
        raw[off + 3] = Math.round((a / n) * 255);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Дизайн значка ----------
function inRoundedRect(px, py, size, radius) {
  const x0 = 0, y0 = 0, x1 = size, y1 = size;
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const cx = Math.max(x0 + radius, Math.min(px, x1 - radius));
  const cy = Math.max(y0 + radius, Math.min(py, y1 - radius));
  return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2 || (px >= x0 + radius && px <= x1 - radius) || (py >= y0 + radius && py <= y1 - radius);
}

function iconPixel(size) {
  return (px, py) => {
    if (!inRoundedRect(px, py, size, size * 0.22)) return [0, 0, 0, 0];
    // Столбики: ширина 14% размера, низ на 76% высоты.
    const bw = size * 0.14;
    const bottom = size * 0.76;
    const bars = [
      { x: size * 0.19, h: size * 0.28, color: [255, 255, 255] },
      { x: size * 0.43, h: size * 0.42, color: [255, 255, 255] },
      { x: size * 0.67, h: size * 0.56, color: [165, 226, 196] },
    ];
    for (const bar of bars) {
      if (px >= bar.x && px <= bar.x + bw && py >= bottom - bar.h && py <= bottom) {
        return [...bar.color, 1];
      }
    }
    return [26, 127, 75, 1]; // #1a7f4b
  };
}

// ---------- ICO ----------
function buildIco() {
  const sizes = [48, 32, 16];
  const images = sizes.map((s) => png(s, iconPixel(s)));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  const entries = [];
  let offset = 6 + 16 * sizes.length;
  sizes.forEach((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s === 256 ? 0 : s;
    e[1] = s === 256 ? 0 : s;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(images[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    entries.push(e);
  });

  return Buffer.concat([header, ...entries, ...images]);
}

module.exports = { png, iconPixel };

if (require.main === module) {
  const ico = buildIco();
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'favicon.ico'), ico);
  console.log('favicon.ico written:', ico.length, 'bytes');
}
