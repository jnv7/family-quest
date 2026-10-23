import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeValidationError, validateTheme } from './validate-theme';

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the minimal theme, edited with `change` (a function over its parsed `theme.json`). */
function themeWith(change: (theme: any) => void) {
  const root = mkdtempSync(join(tmpdir(), 'family-quest-vault-'));
  created.push(root);
  const dir = join(root, 'minimal');
  cpSync('src/themes/minimal', dir, { recursive: true });
  const file = join(dir, 'theme.json');
  const theme = JSON.parse(readFileSync(file, 'utf8'));
  change(theme);
  writeFileSync(file, JSON.stringify(theme));
  return { file, validate: () => validateTheme({ themeDir: dir, localeFile: 'src/i18n/pt-PT.json' }) };
}

function failure(run: () => void): ThemeValidationError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ThemeValidationError);
    return error as ThemeValidationError;
  }
  throw new Error('Expected validation to fail');
}

const spots = (overrides: Record<string, unknown> = {}) => ({
  low: { x: 10, y: 5, width: 80, height: 25 },
  mid: { x: 10, y: 35, width: 80, height: 25 },
  high: { x: 10, y: 65, width: 80, height: 25 },
  ...overrides,
});
const withSpots = (extra: Record<string, unknown> = {}, spotValues = spots()) => (t: any) => {
  t.vault = { ...t.vault, background: t.map.background, aspectRatio: 0.5625, spots: spotValues, ...extra };
};

describe('the vault of a theme', () => {
  it('validates without a background and spots, stacking the tiers', () => {
    expect(() => themeWith(() => {}).validate()).not.toThrow();
  });

  it('validates with a background, an aspect ratio and spots', () => {
    expect(() => themeWith(withSpots()).validate()).not.toThrow();
  });

  it('fails with spots but no background, naming the file and the missing part', () => {
    const theme = themeWith((t) => {
      withSpots()(t);
      delete t.vault.background;
    });
    const error = failure(theme.validate);
    expect(error.file).toBe(theme.file);
    expect(error.jsonPath).toBe('/vault');
    expect(error.message).toContain('background is missing');
  });

  it('fails with a background but no spots', () => {
    const error = failure(
      themeWith((t) => {
        t.vault = { ...t.vault, background: t.map.background, aspectRatio: 0.5625 };
      }).validate,
    );
    expect(error.message).toContain('spots is missing');
  });

  it('fails for a spot outside the background', () => {
    const error = failure(themeWith(withSpots({}, spots({ high: { x: 10, y: 85, width: 80, height: 25 } }))).validate);
    expect(error.jsonPath).toBe('/vault/spots/high');
    expect(error.message).toContain('outside the background');
  });

  it('fails for spots that overlap', () => {
    const error = failure(themeWith(withSpots({}, spots({ mid: { x: 10, y: 20, width: 80, height: 25 } }))).validate);
    expect(error.jsonPath).toBe('/vault/spots/mid');
    expect(error.message).toContain('overlaps the spot of tier "low"');
  });

  it('fails without an invite text for a tier', () => {
    const error = failure(
      themeWith((t) => {
        delete t.vault.invite.mid;
      }).validate,
    );
    expect(error.jsonPath).toBe('/vault/invite/mid');
  });

  it('fails without the token noun or its art', () => {
    expect(failure(themeWith((t) => delete t.roles.token).validate).jsonPath).toBe('/roles/token');
    expect(failure(themeWith((t) => delete t.tokenArt).validate).jsonPath).toBe('/tokenArt');
  });
});
