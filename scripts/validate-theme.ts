/**
 * Validates theme packages (docs/architecture.md §6). Run with `npm run validate-theme`.
 *
 * Checks, in order, failing on the first error with the file and JSON path:
 * 1. schemas; 2. theme id; 3. slots; 4. art files; 5. placeholders; 6. image files: formats,
 * credits, licences, budgets and metadata (`scripts/theme-assets.ts`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import { parsePlaceholder, placeholderBodies } from '../src/theme/placeholders.ts';
import { checkThemeAssets } from './theme-assets.ts';
import { ThemeValidationError } from './theme-error.ts';

/** **[proposal]** Enough slots in every tier for the draw to feel varied (SPEC.md §8). */
export const MIN_SLOTS_PER_TIER = 3;
const TIERS = ['low', 'mid', 'high'];

export { ThemeValidationError };

export interface ValidateThemeOptions {
  /** Folder of the theme, such as `src/themes/minimal`. */
  themeDir: string;
  /** The neutral locale file, such as `src/i18n/pt-PT.json`. */
  localeFile: string;
  /** Folder with the JSON Schemas. Default: `schemas`. */
  schemasDir?: string;
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

function describeAjvError(error: ErrorObject): { path: string; message: string } {
  const missing = error.keyword === 'required' ? `/${String(error.params.missingProperty)}` : '';
  const extra = error.keyword === 'additionalProperties' ? `/${String(error.params.additionalProperty)}` : '';
  return { path: `${error.instancePath}${missing}${extra}`, message: error.message ?? 'is invalid' };
}

export function validateTheme(options: ValidateThemeOptions): void {
  const { themeDir, localeFile, schemasDir = 'schemas' } = options;
  const themeFile = join(themeDir, 'theme.json');
  const catalogFile = join(themeDir, 'catalog.json');

  // 1. Schemas.
  const ajv = new Ajv2020({ allErrors: false });
  // The catalogue schema refers to the theme schema, so the latter is registered by its $id.
  const themeSchema = readJson(join(schemasDir, 'theme.schema.json')) as object;
  ajv.addSchema(themeSchema);
  const validators = [
    { file: themeFile, validate: ajv.compile(themeSchema) },
    { file: catalogFile, validate: ajv.compile(readJson(join(schemasDir, 'catalog.schema.json')) as object) },
    { file: localeFile, validate: ajv.compile(readJson(join(schemasDir, 'locale.schema.json')) as object) },
  ];
  const documents = new Map<string, any>();
  for (const { file, validate } of validators) {
    const document = readJson(file);
    documents.set(file, document);
    if (!validate(document)) {
      const { path, message } = describeAjvError(validate.errors![0]!);
      throw new ThemeValidationError(file, path, message);
    }
  }
  const theme = documents.get(themeFile);
  const catalog = documents.get(catalogFile);
  const locale = documents.get(localeFile);

  // 2. Theme id.
  if (theme.id !== basename(themeDir)) {
    throw new ThemeValidationError(themeFile, '/id', `"${theme.id}" must equal the folder name "${basename(themeDir)}"`);
  }

  // 3. Slots.
  const seen = new Set<string>();
  catalog.slots.forEach((slot: { slot: string }, index: number) => {
    if (seen.has(slot.slot)) throw new ThemeValidationError(catalogFile, `/slots/${index}/slot`, `duplicate slot "${slot.slot}"`);
    seen.add(slot.slot);
  });
  for (const tier of TIERS) {
    const count = catalog.slots.filter((s: { tier: string }) => s.tier === tier).length;
    if (count < MIN_SLOTS_PER_TIER) {
      throw new ThemeValidationError(catalogFile, '/slots', `tier "${tier}" has ${count} slots, at least ${MIN_SLOTS_PER_TIER} are needed`);
    }
  }

  // 4. Art files.
  for (const [file, document] of [[themeFile, theme], [catalogFile, catalog]] as const) {
    for (const { path, image } of findImages(document, '')) {
      if (!existsSync(join(themeDir, image))) throw new ThemeValidationError(file, path, `file "${image}" does not exist`);
    }
  }

  // 5. Placeholders.
  for (const [key, text] of Object.entries(locale.messages as Record<string, string>)) {
    try {
      for (const body of placeholderBodies(text)) parsePlaceholder(body);
    } catch (error) {
      throw new ThemeValidationError(localeFile, `/messages/${key}`, error instanceof Error ? error.message : String(error));
    }
  }

  // 6. Image files.
  checkThemeAssets({ themeDir, theme, catalog, schemasDir });
}

function findImages(node: unknown, path: string): Array<{ path: string; image: string }> {
  if (Array.isArray(node)) return node.flatMap((item, i) => findImages(item, `${path}/${i}`));
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) =>
    key === 'image' && typeof value === 'string' ? [{ path: `${path}/image`, image: value }] : findImages(value, `${path}/${key}`),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const themes = readJson('scripts/validated-themes.json') as string[];
  let failed = false;
  for (const themeId of themes) {
    try {
      validateTheme({ themeDir: join('src', 'themes', themeId), localeFile: join('src', 'i18n', 'pt-PT.json') });
      console.log(`validate-theme: ${themeId} passed`);
    } catch (error) {
      if (!(error instanceof ThemeValidationError)) throw error;
      console.error(error.message);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}
