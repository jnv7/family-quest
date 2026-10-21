/**
 * The checks on a theme's image files (docs/architecture.md §6, docs/plans/0.7.md decision 4):
 * formats, credits, licences, budgets and metadata. Run by `validate-theme` for every shipped theme.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, posix } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ImageError, readImageInfo } from './image-info.ts';
import { ThemeValidationError } from './theme-error.ts';

export const ALLOWED_LICENCES = ['CC0-1.0', 'MIT'] as const;

export type ArtKind = 'map' | 'art' | 'collectible' | 'icon';

export interface Budget {
  maxWidth: number;
  maxHeight: number;
  maxBytes: number;
}

/** The size of each kind of art. `art` covers places, home variants, the character and reward art. */
export const BUDGETS: Record<Exclude<ArtKind, 'icon'>, Budget> = {
  map: { maxWidth: 1080, maxHeight: 1920, maxBytes: 400 * 1024 },
  art: { maxWidth: 512, maxHeight: 512, maxBytes: 80 * 1024 },
  collectible: { maxWidth: 512, maxHeight: 512, maxBytes: 60 * 1024 },
};
/** All the art of one theme, icons included. */
export const THEME_TOTAL_BYTES = 2.5 * 1024 * 1024;

const RASTER = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif', '.avif', '.bmp', '.tif', '.tiff']);

interface Credit {
  file: string;
  author: string;
  source: string;
  licence: string;
}

/** Every file under `<themeDir>/assets`, as paths relative to the theme folder with `/` separators. */
export function assetFiles(themeDir: string): string[] {
  const root = join(themeDir, 'assets');
  if (!existsSync(root)) return [];
  const walk = (dir: string, prefix: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      const relative = posix.join(prefix, name);
      return statSync(path).isDirectory() ? walk(path, relative) : [relative];
    });
  return walk(root, 'assets').sort();
}

/** The kind of each image the theme refers to, by where it is used. */
function kindsOf(theme: unknown, catalog: unknown): Map<string, ArtKind> {
  const kinds = new Map<string, ArtKind>();
  const visit = (node: unknown, path: string, base: ArtKind): void => {
    if (Array.isArray(node)) return node.forEach((item, i) => visit(item, `${path}/${i}`, base));
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      const here = `${path}/${key}`;
      if (key === 'image' && typeof value === 'string') {
        const kind: ArtKind = path.startsWith('/install/icons') ? 'icon' : path.startsWith('/map/background') ? 'map' : base;
        kinds.set(value, kind);
      } else {
        visit(value, here, base);
      }
    }
  };
  visit(theme, '', 'art');
  visit(catalog, '', 'collectible');
  return kinds;
}

export interface AssetCheckOptions {
  themeDir: string;
  theme: unknown;
  catalog: unknown;
  schemasDir: string;
}

export function checkThemeAssets({ themeDir, theme, catalog, schemasDir }: AssetCheckOptions): void {
  const files = assetFiles(themeDir);
  const at = (file: string) => join(themeDir, file);

  // Formats: raster art is WebP; PNG only for the install icons; SVG is allowed for vector art.
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (ext === '.svg') continue;
    if (ext === '.png' && file.startsWith('assets/icons/')) continue;
    if (ext === '.webp') continue;
    const reason = ext === '.png' ? 'PNG is only for install icons under assets/icons/; use WebP' : RASTER.has(ext) ? `${ext} is not allowed; use WebP` : `${ext || 'this file'} is not an image format the themes accept`;
    throw new ThemeValidationError(at(file), '', reason);
  }

  // Credits.
  const creditsFile = join(themeDir, 'credits.json');
  if (!existsSync(creditsFile)) throw new ThemeValidationError(creditsFile, '', 'does not exist; every theme lists the credits of its images');
  const ajv = new Ajv2020({ allErrors: false });
  const validate = ajv.compile(JSON.parse(readFileSync(join(schemasDir, 'credits.schema.json'), 'utf8')) as object);
  const credits: unknown = JSON.parse(readFileSync(creditsFile, 'utf8'));
  if (!validate(credits)) {
    const error = validate.errors![0]!;
    const extra = error.keyword === 'additionalProperties' ? `/${String(error.params.additionalProperty)}` : '';
    const missing = error.keyword === 'required' ? `/${String(error.params.missingProperty)}` : '';
    throw new ThemeValidationError(creditsFile, `${error.instancePath}${missing}${extra}`, error.message ?? 'is invalid');
  }
  const entries = (credits as { assets: Credit[] }).assets;
  const credited = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (!files.includes(entry.file)) throw new ThemeValidationError(creditsFile, `/assets/${index}/file`, `"${entry.file}" is not a file of this theme`);
    credited.set(entry.file, (credited.get(entry.file) ?? 0) + 1);
    if (credited.get(entry.file)! > 1) throw new ThemeValidationError(creditsFile, `/assets/${index}/file`, `"${entry.file}" has more than one entry`);
  });
  for (const file of files) {
    if (!credited.has(file)) throw new ThemeValidationError(at(file), '', `has no entry in ${creditsFile}`);
  }

  // Licences.
  entries.forEach((entry, index) => {
    if (!(ALLOWED_LICENCES as readonly string[]).includes(entry.licence)) {
      throw new ThemeValidationError(creditsFile, `/assets/${index}/licence`, `"${entry.licence}" is not allowed; allowed: ${ALLOWED_LICENCES.join(', ')}`);
    }
  });

  // Budgets and metadata.
  const kinds = kindsOf(theme, catalog);
  let total = 0;
  for (const file of files) {
    const bytes = readFileSync(at(file));
    total += bytes.length;
    const ext = extname(file).toLowerCase();
    const kind: ArtKind = kinds.get(file) ?? (file.startsWith('assets/icons/') ? 'icon' : 'art');
    if (kind !== 'icon') {
      const budget = BUDGETS[kind];
      if (bytes.length > budget.maxBytes) {
        throw new ThemeValidationError(at(file), '', `is ${bytes.length} bytes, over the ${budget.maxBytes} bytes budget for ${kind} art`);
      }
    }
    if (ext === '.svg') continue;
    let info;
    try {
      info = readImageInfo(bytes);
    } catch (error) {
      if (error instanceof ImageError) throw new ThemeValidationError(at(file), '', error.message);
      throw error;
    }
    if (kind !== 'icon') {
      const budget = BUDGETS[kind];
      if (info.width > budget.maxWidth || info.height > budget.maxHeight) {
        throw new ThemeValidationError(at(file), '', `is ${info.width}×${info.height}, over the ${budget.maxWidth}×${budget.maxHeight} budget for ${kind} art`);
      }
    }
    if (info.metadata.length > 0) {
      throw new ThemeValidationError(at(file), '', `contains ${info.metadata.join(' and ')} metadata; run art:prepare to strip it`);
    }
  }
  if (total > THEME_TOTAL_BYTES) {
    throw new ThemeValidationError(join(themeDir, 'assets'), '', `holds ${total} bytes of art, over the ${THEME_TOTAL_BYTES} bytes budget of a theme`);
  }
}
