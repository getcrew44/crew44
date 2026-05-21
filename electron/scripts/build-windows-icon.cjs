#!/usr/bin/env node
// Generates electron/assets/crew44.ico from electron/assets/crew44.icns.
// Run once (or whenever the .icns changes) — the produced .ico is
// committed alongside the .icns.
//
// Uses macOS-builtin iconutil to extract the iconset, then encodes a
// modern PNG-in-ICO file (Vista+ supports PNG entries, which is every
// Windows target we care about). No external dependencies.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const src = path.join(repoRoot, 'electron', 'assets', 'crew44.icns');
const out = path.join(repoRoot, 'electron', 'assets', 'crew44.ico');
const tmp = path.join(require('os').tmpdir(), 'crew44.iconset');

if (!fs.existsSync(src)) {
  console.error(`Missing source: ${src}`);
  process.exit(1);
}

fs.rmSync(tmp, { recursive: true, force: true });
execFileSync('iconutil', ['--convert', 'iconset', src, '--output', tmp], { stdio: 'inherit' });

// Collect every PNG iconutil produced. Standard names:
//   icon_16x16.png, icon_16x16@2x.png (= 32px), icon_32x32.png, etc.
// We map each file to its rendered pixel size.
const entries = [];
for (const name of fs.readdirSync(tmp).sort()) {
  const m = name.match(/icon_(\d+)x\d+(@(\d+)x)?\.png/);
  if (!m) continue;
  const baseSize = Number(m[1]);
  const scale = m[3] ? Number(m[3]) : 1;
  const size = baseSize * scale;
  entries.push({ size, path: path.join(tmp, name) });
}

// Dedup by pixel size — keep one PNG per ICO entry size. Picks the file
// alphabetically last, which favors @2x retina renders (typically higher
// quality than the non-retina at the same pixel size).
const bySize = new Map();
for (const e of entries) bySize.set(e.size, e);

// Windows expects standard ICO sizes. Keep what we have at these sizes.
const wanted = [16, 24, 32, 48, 64, 128, 256];
const pngs = wanted
  .filter(s => bySize.has(s))
  .map(s => ({ size: s, data: fs.readFileSync(bySize.get(s).path) }));

if (pngs.length === 0) {
  console.error('No usable PNG sizes extracted from icns.');
  process.exit(1);
}

// ICO file layout: 6-byte header + N×16-byte directory entries + N PNG payloads.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);   // reserved
header.writeUInt16LE(1, 2);   // type = icon
header.writeUInt16LE(pngs.length, 4);

const dir = Buffer.alloc(16 * pngs.length);
let offset = 6 + 16 * pngs.length;
const payloads = [];
for (let i = 0; i < pngs.length; i++) {
  const { size, data } = pngs[i];
  // In ICO width/height fields, 0 means 256.
  const wh = size >= 256 ? 0 : size;
  const o = i * 16;
  dir.writeUInt8(wh, o + 0);          // width
  dir.writeUInt8(wh, o + 1);          // height
  dir.writeUInt8(0, o + 2);           // color count (0 = unspecified)
  dir.writeUInt8(0, o + 3);           // reserved
  dir.writeUInt16LE(1, o + 4);        // color planes
  dir.writeUInt16LE(32, o + 6);       // bits per pixel
  dir.writeUInt32LE(data.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += data.length;
  payloads.push(data);
}

fs.writeFileSync(out, Buffer.concat([header, dir, ...payloads]));
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`Wrote ${out}`);
console.log(`  ${pngs.length} sizes: ${pngs.map(p => `${p.size}px`).join(', ')}`);
console.log(`  ${fs.statSync(out).size} bytes`);
