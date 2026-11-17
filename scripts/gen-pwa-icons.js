// Генератор PWA-иконок тем же значком, что и favicon:
// зелёный квадрат + столбики диаграммы. Без внешних зависимостей,
// PNG-кодировщик берём из gen-favicon.js.
const fs = require('fs');
const path = require('path');

const { png } = require('./gen-favicon.js');

const OUT_DIR = path.join(__dirname, '..', 'src', 'assets', 'icons');
const BG = [26, 127, 75]; // #1a7f4b
const ACCENT = [165, 226, 196];

/** Скруглённый квадрат — для обычных (не maskable) иконок. */
function inRoundedRect(px, py, size, radius) {
  const cx = Math.max(radius, Math.min(px, size - radius));
  const cy = Math.max(radius, Math.min(py, size - radius));
  return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2 || (px >= radius && px <= size - radius) || (py >= radius && py <= size - radius);
}

/** Пиксель значка: столбики диаграммы, масштаб — вокруг центра. */
function barPixel(size, scale) {
  const bw = size * 0.14 * scale;
  const bottom = size * (0.5 + (0.76 - 0.5) * scale);
  const bars = [
    { x: 0.19, h: 0.28, color: [255, 255, 255] },
    { x: 0.43, h: 0.42, color: [255, 255, 255] },
    { x: 0.67, h: 0.56, color: ACCENT },
  ].map((bar) => ({
    x: size * (0.5 + (bar.x - 0.5) * scale),
    h: size * bar.h * scale,
    color: bar.color,
  }));

  return (px, py) => {
    for (const bar of bars) {
      if (px >= bar.x && px <= bar.x + bw && py >= bottom - bar.h && py <= bottom) {
        return [...bar.color, 1];
      }
    }
    return null;
  };
}

/** Иконка со скруглёнными углами и прозрачным фоном. */
function roundedIcon(size) {
  const bars = barPixel(size, 1);
  return png(size, (px, py) => {
    if (!inRoundedRect(px, py, size, size * 0.22)) {
      return [0, 0, 0, 0];
    }
    return bars(px, py) ?? [...BG, 1];
  });
}

/**
 * Иконка на весь квадрат без прозрачности — для maskable и apple-touch.
 * Safari сам скругляет углы, Android обрезает по своей маске,
 * поэтому значок уменьшен и умещается в безопасную зону.
 */
function fullBleedIcon(size, scale) {
  const bars = barPixel(size, scale);
  return png(size, (px, py) => bars(px, py) ?? [...BG, 1]);
}

const targets = [
  { file: 'icon-192.png', buffer: roundedIcon(192) },
  { file: 'icon-512.png', buffer: roundedIcon(512) },
  // Безопасная зона maskable — круг радиусом 40% от ширины,
  // поэтому столбики сжимаем до 72%.
  { file: 'icon-maskable-512.png', buffer: fullBleedIcon(512, 0.72) },
  { file: 'apple-touch-icon.png', buffer: fullBleedIcon(180, 0.88) },
];

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const { file, buffer } of targets) {
  fs.writeFileSync(path.join(OUT_DIR, file), buffer);
  console.log(`${file}: ${buffer.length} bytes`);
}
