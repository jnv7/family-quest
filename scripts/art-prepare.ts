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
 * `kind` is `map`, `art` (places, home variants, the character, reward art), `collectible`, or `icon` (an install icon: a PNG
 * of an exact `size` on an opaque `background`, with the picture inside the middle `safe` share; see `prepareIcon`).
 * Each image is fitted inside the budget of its kind, converted to sRGB WebP, and written with
 * no metadata at all (EXIF, XMP, ICC). If a file is still too heavy, quality is lowered until it fits.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { BUDGETS } from './theme-assets.ts';

export type PrepareKind = keyof typeof BUDGETS | 'icon';

export interface ArtItem {
  source: string;
  target: string;
  kind: PrepareKind;
  /** `icon` only: the exact side of the square PNG, such as 192, 512 or 180. */
  size?: number;
  /** `icon` only: the opaque background, as `#rrggbb`. */
  background?: string;
  /** `icon` only: the share of the side the picture fits in; 0.8 keeps a maskable icon inside its safe zone. Default 0.9. */
  safe?: number;
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

export interface IconOptions {
  size: number;
  background: string;
  safe?: number;
}

/**
 * An install icon: a square PNG of exactly `size`, opaque, with the picture fitted in the middle `safe` share of
 * it on `background`, and no metadata. The picture may be a vector (SVG) or a raster.
 */
export async function prepareIcon(source: Buffer, { size, background, safe = 0.9 }: IconOptions): Promise<Buffer> {
  if (!Number.isInteger(size) || size < 16 || size > 1024) throw new ArtPrepareError('an icon "size" must be a whole number from 16 to 1024');
  if (!/^#[0-9a-fA-F]{6}$/.test(background)) throw new ArtPrepareError('an icon "background" must be a colour such as #14324a');
  if (!(safe > 0 && safe <= 1)) throw new ArtPrepareError('an icon "safe" must be a share above 0 and up to 1');
  const inner = Math.round(size * safe);
  const picture = await sharp(source, { density: 384 }).resize({ width: inner, height: inner, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background } })
    .composite([{ input: picture, gravity: 'centre' }])
    .toColourspace('srgb')
    .png() // no metadata is written unless asked for
    .toBuffer();
}

/** Fits one image in the budget of its kind and encodes it as WebP without metadata. */
export async function prepareImage(source: Buffer, kind: Exclude<PrepareKind, 'icon'>): Promise<Buffer> {
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
    if (!(item.kind in BUDGETS) && item.kind !== 'icon') throw new ArtPrepareError(`${where}: "kind" must be one of ${[...Object.keys(BUDGETS), 'icon'].join(', ')}`);
    const extension = item.kind === 'icon' ? 'png' : 'webp';
    const folderRule = item.kind === 'icon' ? 'assets/icons/' : 'assets/';
    if (!new RegExp(`^${folderRule}[A-Za-z0-9._/-]+\\.${extension}$`).test(item.target) || item.target.includes('..')) {
      throw new ArtPrepareError(`${where}: "target" must be a .${extension} path under ${folderRule}`);
    }
    if (item.kind === 'icon' && (item.size === undefined || item.background === undefined)) {
      throw new ArtPrepareError(`${where}: an icon needs "size" and "background"`);
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
      output = item.kind === 'icon' ? await prepareIcon(source, { size: item.size!, background: item.background!, safe: item.safe }) : await prepareImage(source, item.kind);
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
