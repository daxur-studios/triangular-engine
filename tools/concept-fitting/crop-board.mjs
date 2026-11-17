// Cuts the crops listed in a concept manifest out of its source sheet and draws one board
// showing every crop rectangle on the sheet, so a person can check the manifest at a glance.
//
// The source sheet is found by content hash inside a local folder. No path to the concept
// art is ever stored in the repository.
//
//   node tools/concept-fitting/crop-board.mjs --source-dir <folder> [--manifest <file>] [--out <dir>]
//
// The source folder may also come from the CONCEPT_SOURCE_DIR environment variable.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Returns the bytes of the file in `dir` whose hash matches, or throws with the list it tried. */
export function findSourceByHash(dir, hash) {
  const names = fs.readdirSync(dir).filter((name) => /\.(png|jpe?g)$/i.test(name)).sort();
  for (const name of names) {
    const bytes = fs.readFileSync(path.join(dir, name));
    if (sha256(bytes) === hash) return bytes;
  }
  throw new Error(`No image in the source folder matches sha256 ${hash} (checked ${names.length} images).`);
}

/** Throws when a manifest crop is malformed or falls outside the sheet. */
export function validateManifest(manifest) {
  if (manifest.schema !== 1) throw new Error('Unsupported manifest schema.');
  const { width, height } = manifest.sheet;
  const ids = new Set();
  for (const crop of manifest.crops) {
    if (ids.has(crop.id)) throw new Error(`Duplicate crop id ${crop.id}.`);
    ids.add(crop.id);
    const { x, y, w, h } = crop.rect;
    if (![x, y, w, h].every(Number.isInteger) || w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > width || y + h > height) {
      throw new Error(`Crop ${crop.id} is outside the ${width}x${height} sheet.`);
    }
  }
}

function overlaySvg(manifest, scale) {
  const { width, height } = manifest.sheet;
  const boxes = manifest.crops.map((crop) => {
    const { x, y, w, h } = crop.rect;
    const colour = crop.include ? '#d2142a' : '#8a8a8a';
    const dash = crop.include ? '' : ' stroke-dasharray="10 6"';
    return `<rect x="${x * scale}" y="${y * scale}" width="${w * scale}" height="${h * scale}" fill="none" stroke="${colour}" stroke-width="2"${dash}/>`
      + `<text x="${(x + 4) * scale}" y="${(y + 16) * scale}" font-family="Arial" font-size="13" fill="${colour}">${crop.id}</text>`;
  });
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}">${boxes.join('')}</svg>`);
}

export async function run({ sourceDir, manifestPath, outDir }) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  validateManifest(manifest);
  const bytes = findSourceByHash(sourceDir, manifest.sheet.sha256);
  const meta = await sharp(bytes).metadata();
  if (meta.width !== manifest.sheet.width || meta.height !== manifest.sheet.height) {
    throw new Error(`Sheet is ${meta.width}x${meta.height}, manifest says ${manifest.sheet.width}x${manifest.sheet.height}.`);
  }
  fs.mkdirSync(path.join(outDir, 'crops'), { recursive: true });
  const report = [];
  for (const crop of manifest.crops) {
    const { x, y, w, h } = crop.rect;
    const png = await sharp(bytes).extract({ left: x, top: y, width: w, height: h }).png().toBuffer();
    fs.writeFileSync(path.join(outDir, 'crops', `${crop.id}.png`), png);
    report.push({ id: crop.id, include: crop.include, rect: crop.rect, pngSha256: sha256(png) });
  }
  const scale = 0.6;
  await sharp(bytes).resize(Math.round(meta.width * scale), Math.round(meta.height * scale))
    .composite([{ input: overlaySvg(manifest, scale), left: 0, top: 0 }])
    .png().toFile(path.join(outDir, 'manifest-board.png'));
  fs.writeFileSync(path.join(outDir, 'crop-report.json'), `${JSON.stringify({ sheet: manifest.sheet.name, crops: report }, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const sourceDir = option('--source-dir') ?? process.env.CONCEPT_SOURCE_DIR;
  if (!sourceDir) { console.error('Pass --source-dir <folder> or set CONCEPT_SOURCE_DIR.'); process.exit(2); }
  const manifestPath = option('--manifest') ?? path.join(here, 'manifests', 'headshots-and-angles.json');
  const outDir = option('--out') ?? path.resolve('artifacts', 'concept-fitting', 'headshots-and-angles');
  const report = await run({ sourceDir, manifestPath, outDir });
  console.log(`Wrote ${report.length} crops and manifest-board.png to ${outDir}`);
}
