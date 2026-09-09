/**
 * Derives every icon size the browser and OS ask for from a single source.
 *
 *   node scripts/gen-icons.mjs
 *
 * The source is brand/icon-512.png — the Novatrix NX mark. Referencing that
 * 512px original as the favicon would cost ~325 KB on every page load, so the
 * small sizes are generated instead.
 *
 * Outputs land in public/icons/ and are committed, so the build stays free of
 * an image dependency at deploy time.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
// Kept OUT of public/ on purpose: anything in public/ is copied verbatim into
// dist/ and deployed. The 512px master is only an input to this script, and
// shipping it alongside its own generated copy wasted 325 KB per deploy.
const SOURCE = path.join(ROOT, 'brand', 'icon-512.png');
const OUT = path.join(ROOT, 'public', 'icons');

if (!fs.existsSync(SOURCE)) {
  console.error('✖ brand/icon-512.png not found.');
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

/**
 * `maskable` icons must survive being cropped to a circle on Android, so the
 * mark is inset with padding. Everything else is edge-to-edge.
 */
const TARGETS = [
  { file: 'favicon-16.png', size: 16 },
  { file: 'favicon-32.png', size: 32 },
  { file: 'favicon-48.png', size: 48 },
  { file: 'apple-touch-icon.png', size: 180 },
  // 192 + 512 + maskable covers every install surface. Intermediate sizes
  // were 273 KB of variants no platform actually requests.
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'maskable-512.png', size: 512, padding: 0.1 },
];

// Matches the dark navy the mark already sits on, so padding is invisible.
const BACKGROUND = { r: 10, g: 20, b: 40, alpha: 1 };

const results = [];

for (const target of TARGETS) {
  const outPath = path.join(OUT, target.file);

  let pipeline = sharp(SOURCE);

  if (target.padding) {
    const inner = Math.round(target.size * (1 - target.padding * 2));
    const pad = Math.round((target.size - inner) / 2);
    pipeline = pipeline
      .resize(inner, inner, { fit: 'contain', background: BACKGROUND })
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: BACKGROUND });
  } else {
    pipeline = pipeline.resize(target.size, target.size, { fit: 'cover' });
  }

  await pipeline
    .png({ compressionLevel: 9, palette: target.size <= 48 })
    .toFile(outPath);

  results.push({ file: target.file, bytes: fs.statSync(outPath).size });
}

/* ── A multi-resolution favicon.ico for older browsers ────────────────────── */
/*
 * .ico is a container: a 6-byte header, then one 16-byte directory entry per
 * image, then the payloads. PNG data can be embedded directly, which every
 * browser that matters has supported since IE11.
 */
async function writeIco() {
  const sizes = [16, 32, 48];
  const images = await Promise.all(
    sizes.map((s) => sharp(SOURCE).resize(s, s, { fit: 'cover' }).png({ compressionLevel: 9 }).toBuffer()),
  );

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(sizes.length, 4);

  let offset = 6 + sizes.length * 16;
  const entries = [];

  sizes.forEach((size, i) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width  (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(images[i].length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += images[i].length;
    entries.push(entry);
  });

  const ico = Buffer.concat([header, ...entries, ...images]);
  const icoPath = path.join(ROOT, 'public', 'favicon.ico');
  fs.writeFileSync(icoPath, ico);
  return { file: 'favicon.ico', bytes: ico.length };
}

const ico = await writeIco();

/* ── Report ───────────────────────────────────────────────────────────────── */
const kb = (b) => (b / 1024).toFixed(1) + ' KB';

console.log('Generated from brand/icon-512.png (' + kb(fs.statSync(SOURCE).size) + '):\n');
for (const r of results) console.log('  public/icons/' + r.file.padEnd(24) + kb(r.bytes));
console.log('  public/' + ico.file.padEnd(30) + kb(ico.bytes));
console.log(
  '\n  favicon is now ' + kb(results.find((r) => r.file === 'favicon-32.png').bytes) +
  ' instead of ' + kb(fs.statSync(SOURCE).size),
);
