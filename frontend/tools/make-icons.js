/**
 * PWA ikon üreticisi — harici bağımlılık yok (zlib ile PNG kodlar).
 * Kullanım: node tools/make-icons.js
 * Çıktılar: public/icons/icon-192.png, icon-512.png, icon-180.png (apple-touch)
 * Tasarım: lacivert zemin + beyaz/cyan QR benzeri glif (maskable güvenli).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');

// ── PNG kodlama ──────────────────────────────────────────────
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

function encodePNG(pixels, width, height) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // RGBA
    // Scanline başına filter byte (0) ekle
    const raw = Buffer.alloc(height * (width * 4 + 1));
    for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = 0;
        pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

// ── Çizim ────────────────────────────────────────────────────
const BG = [15, 23, 42, 255];     // #0f172a
const FG = [241, 245, 249, 255];  // #f1f5f9 (modüller)
const AC = [34, 211, 238, 255];   // #22d3ee (vurgu)

const GRID = 28; // modül ızgarası

// Deterministik sözde-rastgele veri modülleri (ikona her seferinde aynı bakar)
function dataModule(x, y) {
    let h = (x * 73856093) ^ (y * 19349663);
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) % 100 < 45;
}

// Ters QR mantığı: koyu zemin üzerinde açık modüller
function moduleOn(x, y) {
    const inFinder = (fx, fy) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7;
    const finder = (fx, fy) => {
        if (!inFinder(fx, fy)) return null;
        const dx = x - fx, dy = y - fy;
        const ring = dx === 0 || dx === 6 || dy === 0 || dy === 6;   // 7x7 çerçeve
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;      // 3x3 merkez
        if (ring) return FG;
        if (core) return AC;
        return BG;
    };
    // 3 köşe finder
    let m = finder(0, 0) || finder(GRID - 7, 0) || finder(0, GRID - 7);
    if (m) return m;
    // Alignment (sağ alt) 5x5
    const ax = GRID - 9, ay = GRID - 9;
    if (x >= ax && x < ax + 5 && y >= ay && y < ay + 5) {
        const dx = x - ax, dy = y - ay;
        if (dx === 0 || dx === 4 || dy === 0 || dy === 4) return FG;
        if (dx === 2 && dy === 2) return AC;
        return BG;
    }
    // Timing pattern (satır/sütun 6)
    if (y === 6 && x > 7 && x < GRID - 9) return x % 2 === 0 ? FG : BG;
    if (x === 6 && y > 7 && y < GRID - 9) return y % 2 === 0 ? FG : BG;
    return dataModule(x, y) ? FG : BG;
}

function render(size) {
    const margin = Math.floor(size * 0.17);          // maskable güvenli alan
    const module = Math.floor((size - margin * 2) / GRID);
    const glyph = module * GRID;
    const off = Math.floor((size - glyph) / 2);
    const px = Buffer.alloc(size * size * 4);

    for (let yy = 0; yy < size; yy++) {
        for (let xx = 0; xx < size; xx++) {
            let color = BG;
            if (xx >= off && yy >= off && xx < off + glyph && yy < off + glyph) {
                const gx = Math.min(GRID - 1, Math.floor((xx - off) / module));
                const gy = Math.min(GRID - 1, Math.floor((yy - off) / module));
                color = moduleOn(gx, gy);
            }
            const i = (yy * size + xx) * 4;
            px[i] = color[0]; px[i + 1] = color[1]; px[i + 2] = color[2]; px[i + 3] = color[3];
        }
    }
    return encodePNG(px, size, size);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512, 180]) {
    const file = path.join(OUT_DIR, `icon-${size}.png`);
    fs.writeFileSync(file, render(size));
    console.log(`Yazıldı: ${file} (${fs.statSync(file).size} bayt)`);
}
