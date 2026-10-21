/**
 * Turns downloaded source art into the files a theme ships (docs/plans/0.7.md, delivery 0.7.3).
 * Run with `npm run art:prepare -- <folder>`.
 *
 * The folder holds the source images and an `art.json` that maps them. It stays outside the
 * repository (only the processed files are committed):
 *
 *   { "theme": "pirates",
 *     "items": [ { "source": "ships/ship_large.png", "target": "assets/home/adult.webp", "kind": "art" } ] }
 *
 * `kind` is `map`, `art` (places, home variants, the character, reward art) or `collectible`.
 * Each image is fitted inside the budget of its kind, converted to sRGB WebP, and written with
 * no metadata at all (EXIF, XMP, ICC). If a file is still too heavy, quality is lowered until it fits.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { BUDGETS } from './theme-assets.ts';

export type PrepareKind = keyof typeof BUDGETS;

export interface ArtItem {
  source: string;
  target: string;
  kind: PrepareKind;
}

export interface ArtMapping {
  theme: string;
  items: ArtItem[];
}

export class ArtPrepareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtPrepareError';
  }
}

const QUALITIES = [82, 70, 58, 46, 34];

/** Fits one image in the budget of its kind and encodes it as WebP without metadata. */
export async function prepareImage(source: Buffer, kind: PrepareKind): Promise<Buffer> {
  const budget = BUDGETS[kind];
  for (const quality of QUALITIES) {
    const output = await sharp(source)
      .rotate() // applies the EXIF orientation, which the output no longer carries
      .resize({ width: budget.maxWidth, height: budget.maxHeight, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .webp({ quality })
      .toBuffer(); // sharp keeps no metadata unless asked to
    if (output.length <= budget.maxBytes) return output;
  }
  throw new ArtPrepareError(`does not fit ${budget.maxBytes} bytes for ${kind} art, even at the lowest quality; use a simpler or smaller source`);
}

function readMapping(folder: string): ArtMapping {
  const file = join(folder, 'art.json');
  let mapping: unknown;
  try {
    mapping = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ArtPrepareError(`${file} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { theme, items } = (mapping ?? {}) as Partial<ArtMapping>;
  if (typeof theme !== 'string' || !/^[a-z][a-z0-9-]*$/.test(theme)) throw new ArtPrepareError(`${file}: "theme" must be a theme id`);
  if (!Array.isArray(items) || items.length === 0) throw new ArtPrepareError(`${file}: "items" must list at least one image`);
  items.forEach((item, index) => {
    const where = `${file}: items[${index}]`;
    if (typeof item?.source !== 'string' || typeof item?.target !== 'string') throw new ArtPrepareError(`${where} needs "source" and "target"`);
    if (!(item.kind in BUDGETS)) throw new ArtPrepareError(`${where}: "kind" must be one of ${Object.keys(BUDGETS).join(', ')}`);
    if (!/^assets\/[A-Za-z0-9._/-]+\.webp$/.test(item.target) || item.target.includes('..')) {
      throw new ArtPrepareError(`${where}: "target" must be a .webp path under assets/`);
    }
    if (isAbsolute(item.source) || relative(folder, resolve(folder, item.source)).startsWith('..')) {
      throw new ArtPrepareError(`${where}: "source" must stay inside the art folder`);
    }
  });
  return { theme, items };
}

export interface PrepareResult {
  target: string;
  bytes: number;
}

/** Processes every item of `<folder>/art.json` into `<themesDir>/<theme>/`. */
export async function prepareArt(folder: string, themesDir = join('src', 'themes')): Promise<PrepareResult[]> {
  const mapping = readMapping(folder);
  const results: PrepareResult[] = [];
  for (const item of mapping.items) {
    let source: Buffer;
    try {
      source = readFileSync(join(folder, item.source));
    } catch {
      throw new ArtPrepareError(`${join(folder, item.source)} cannot be read`);
    }
    let output: Buffer;
    try {
      output = await prepareImage(source, item.kind);
    } catch (error) {
      if (error instanceof ArtPrepareError) throw new ArtPrepareError(`${item.source} ${error.message}`);
      throw new ArtPrepareError(`${item.source} is not an image sharp can read`);
    }
    const target = join(themesDir, mapping.theme, item.target);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output);
    results.push({ target, bytes: output.length });
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2];
  if (!folder) {
    console.error('Usage: npm run art:prepare -- <folder with art.json and the source images>');
    process.exit(1);
  }
  try {
    for (const { target, bytes } of await prepareArt(folder)) console.log(`${target} (${bytes} bytes)`);
    console.log('Now add each new file to the theme\'s credits.json, then run `npm run credits` and `npm run validate-theme`.');
  } catch (error) {
    if (!(error instanceof ArtPrepareError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
